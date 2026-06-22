// STEMS DSP core — no_std WASM module.
//
// Faithful port of the FFT / STFT / iSTFT hot loops from lib/client-demixer.js.
// Orchestration (segmenting, overlap-add weighting, ORT inference) stays in JS.
//
// Design notes:
//  * No external crates, no wasm-bindgen — plain C ABI over WASM linear memory.
//  * All transcendental values (Hann window, FFT twiddle factors, sqrt-based
//    normalization factors) are precomputed in JS and passed in, so this module
//    only performs +, -, *, / — keeping it dependency-free under `no_std`.
//  * Internal math uses f64 to match the JS reference; stored spectra and the
//    audio output use f32, exactly like the JS implementation.
//  * Buffers live in WASM memory and are addressed by byte offset (zero-copy:
//    JS writes/reads the same bytes through typed-array views).

#![no_std]

use core::arch::wasm32;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    wasm32::unreachable()
}

const PAGE: usize = 65536;

extern "C" {
    static __heap_base: u8;
}

static mut BUMP: usize = 0;
static mut HEAP_END: usize = 0;

#[inline]
unsafe fn heap_base() -> usize {
    core::ptr::addr_of!(__heap_base) as usize
}

#[inline]
unsafe fn ensure(top: usize) {
    if HEAP_END == 0 {
        HEAP_END = wasm32::memory_size(0) * PAGE;
    }
    if top > HEAP_END {
        let need = top - HEAP_END;
        let pages = (need + PAGE - 1) / PAGE;
        wasm32::memory_grow(0, pages);
        HEAP_END += pages * PAGE;
    }
}

/// Bump-allocate `n_bytes`, 8-byte aligned. Returns a byte offset into memory.
#[no_mangle]
pub unsafe extern "C" fn alloc(n_bytes: usize) -> usize {
    if BUMP == 0 {
        BUMP = heap_base();
    }
    let p = (BUMP + 7) & !7;
    let end = p + n_bytes;
    ensure(end);
    BUMP = end;
    p
}

/// Current bump pointer — JS saves this as a checkpoint.
#[no_mangle]
pub unsafe extern "C" fn mark() -> usize {
    if BUMP == 0 {
        BUMP = heap_base();
    }
    BUMP
}

/// Reset the bump pointer to a previously saved checkpoint.
#[no_mangle]
pub unsafe extern "C" fn release(p: usize) {
    BUMP = p;
}

#[inline]
unsafe fn f32_slice<'a>(ptr: usize, len: usize) -> &'a [f32] {
    core::slice::from_raw_parts(ptr as *const f32, len)
}

#[inline]
unsafe fn f32_slice_mut<'a>(ptr: usize, len: usize) -> &'a mut [f32] {
    core::slice::from_raw_parts_mut(ptr as *mut f32, len)
}

#[inline]
unsafe fn f64_slice<'a>(ptr: usize, len: usize) -> &'a [f64] {
    core::slice::from_raw_parts(ptr as *const f64, len)
}

#[inline]
unsafe fn f64_slice_mut<'a>(ptr: usize, len: usize) -> &'a mut [f64] {
    core::slice::from_raw_parts_mut(ptr as *mut f64, len)
}

/// In-place radix-2 FFT on (real, imag), matching client-demixer.js `fftInPlace`.
///
/// `tw` holds one (cos, sin) pair per stage (blockSize = 2,4,...,size), already
/// computed for the requested direction in JS. When `inverse`, each bin is
/// divided by `size` afterwards (same order as the JS reference).
unsafe fn fft(real: &mut [f64], imag: &mut [f64], tw: &[f64], inverse: bool) {
    let size = real.len();
    let bits = size.trailing_zeros() as usize;

    // Bit-reversal permutation.
    let mut i = 0usize;
    while i < size {
        let mut rev = 0usize;
        let mut v = i;
        let mut b = 0usize;
        while b < bits {
            rev = (rev << 1) | (v & 1);
            v >>= 1;
            b += 1;
        }
        if rev > i {
            real.swap(i, rev);
            imag.swap(i, rev);
        }
        i += 1;
    }

    let mut block = 2usize;
    let mut stage = 0usize;
    while block <= size {
        let half = block / 2;
        let wre = tw[2 * stage];
        let wim = tw[2 * stage + 1];
        let mut start = 0usize;
        while start < size {
            let mut cre = 1.0f64;
            let mut cim = 0.0f64;
            let mut off = 0usize;
            while off < half {
                let l = start + off;
                let r = l + half;
                let tre = cre * real[r] - cim * imag[r];
                let tim = cre * imag[r] + cim * real[r];
                real[r] = real[l] - tre;
                imag[r] = imag[l] - tim;
                real[l] += tre;
                imag[l] += tim;
                let nre = cre * wre - cim * wim;
                let nim = cre * wim + cim * wre;
                cre = nre;
                cim = nim;
                off += 1;
            }
            start += block;
        }
        block *= 2;
        stage += 1;
    }

    if inverse {
        let n = size as f64;
        let mut k = 0usize;
        while k < size {
            real[k] /= n;
            imag[k] /= n;
            k += 1;
        }
    }
}

/// STFT — port of `stft(signal, nfft, hopLength)`.
///
/// `signal` is f32 (length `signal_len`). `window` is f64[nfft], `tw` are the
/// forward twiddles, `norm_factor` is 1/sqrt(nfft). Outputs are f32 spectra of
/// length numFreqs*numFrames laid out as `[freq * numFrames + frame]`.
/// Returns numFrames.
#[no_mangle]
pub unsafe extern "C" fn stft(
    signal_ptr: usize,
    signal_len: usize,
    nfft: usize,
    hop: usize,
    window_ptr: usize,
    norm_factor: f64,
    tw_ptr: usize,
    real_out_ptr: usize,
    imag_out_ptr: usize,
) -> usize {
    let signal = f32_slice(signal_ptr, signal_len);
    let window = f64_slice(window_ptr, nfft);
    let tw = f64_slice(tw_ptr, 2 * (nfft.trailing_zeros() as usize));

    let num_freqs = nfft / 2 + 1;
    let pad_size = nfft / 2;
    let padded_length = signal_len + 2 * pad_size;
    let num_frames = (padded_length - nfft) / hop + 1;

    let checkpoint = mark();
    let padded = f64_slice_mut(alloc(padded_length * 8), padded_length);
    let frame_re = f64_slice_mut(alloc(nfft * 8), nfft);
    let frame_im = f64_slice_mut(alloc(nfft * 8), nfft);

    // Reflect padding (matches JS exactly).
    let mut i = 0usize;
    while i < pad_size {
        let idx = if i + 1 < signal_len { i + 1 } else { signal_len - 1 };
        padded[pad_size - 1 - i] = signal[idx] as f64;
        i += 1;
    }
    let mut i = 0usize;
    while i < signal_len {
        padded[pad_size + i] = signal[i] as f64;
        i += 1;
    }
    let mut i = 0usize;
    while i < pad_size {
        let idx = if signal_len >= 2 + i { signal_len - 2 - i } else { 0 };
        padded[pad_size + signal_len + i] = signal[idx] as f64;
        i += 1;
    }

    let real_out = f32_slice_mut(real_out_ptr, num_freqs * num_frames);
    let imag_out = f32_slice_mut(imag_out_ptr, num_freqs * num_frames);

    let mut frame = 0usize;
    while frame < num_frames {
        let offset = frame * hop;
        let mut k = 0usize;
        while k < nfft {
            frame_re[k] = padded[offset + k] * window[k];
            frame_im[k] = 0.0;
            k += 1;
        }
        fft(frame_re, frame_im, tw, false);
        let mut freq = 0usize;
        while freq < num_freqs {
            let o = freq * num_frames + frame;
            real_out[o] = (frame_re[freq] * norm_factor) as f32;
            imag_out[o] = (frame_im[freq] * norm_factor) as f32;
            freq += 1;
        }
        frame += 1;
    }

    release(checkpoint);
    num_frames
}

/// iSTFT — port of `istft(real, imag, numFreqs, numFrames, hopLength, outputLength)`.
///
/// `real`/`imag` are f32 spectra `[freq * numFrames + frame]`. `window` is
/// f64[nfft] (nfft = (numFreqs-1)*2), `tw` are the inverse twiddles,
/// `norm_factor` is sqrt(nfft). Writes f32 output of length `output_length`.
#[no_mangle]
pub unsafe extern "C" fn istft(
    real_ptr: usize,
    imag_ptr: usize,
    num_freqs: usize,
    num_frames: usize,
    hop: usize,
    window_ptr: usize,
    norm_factor: f64,
    tw_ptr: usize,
    out_ptr: usize,
    output_length: usize,
) {
    let nfft = (num_freqs - 1) * 2;
    let real = f32_slice(real_ptr, num_freqs * num_frames);
    let imag = f32_slice(imag_ptr, num_freqs * num_frames);
    let window = f64_slice(window_ptr, nfft);
    let tw = f64_slice(tw_ptr, 2 * (nfft.trailing_zeros() as usize));

    let raw_length = (num_frames - 1) * hop + nfft;

    let checkpoint = mark();
    let output = f64_slice_mut(alloc(raw_length * 8), raw_length);
    let window_norm = f64_slice_mut(alloc(raw_length * 8), raw_length);
    let frame_re = f64_slice_mut(alloc(nfft * 8), nfft);
    let frame_im = f64_slice_mut(alloc(nfft * 8), nfft);

    let mut i = 0usize;
    while i < raw_length {
        output[i] = 0.0;
        window_norm[i] = 0.0;
        i += 1;
    }

    let mut frame = 0usize;
    while frame < num_frames {
        let mut freq = 0usize;
        while freq < num_freqs {
            let o = freq * num_frames + frame;
            frame_re[freq] = real[o] as f64 * norm_factor;
            frame_im[freq] = imag[o] as f64 * norm_factor;
            freq += 1;
        }
        // Hermitian symmetry for the upper half.
        let mut freq = 1usize;
        while freq < num_freqs - 1 {
            frame_re[nfft - freq] = frame_re[freq];
            frame_im[nfft - freq] = -frame_im[freq];
            freq += 1;
        }

        fft(frame_re, frame_im, tw, true);

        let offset = frame * hop;
        let mut k = 0usize;
        while k < nfft {
            output[offset + k] += frame_re[k] * window[k];
            window_norm[offset + k] += window[k] * window[k];
            k += 1;
        }
        frame += 1;
    }

    let mut i = 0usize;
    while i < raw_length {
        if window_norm[i] > 1e-8 {
            output[i] /= window_norm[i];
        }
        i += 1;
    }

    let pad_size = nfft / 2;
    let out = f32_slice_mut(out_ptr, output_length);
    let mut i = 0usize;
    while i < output_length {
        let src = pad_size + i;
        out[i] = if src < raw_length { output[src] as f32 } else { 0.0 };
        i += 1;
    }

    release(checkpoint);
}
