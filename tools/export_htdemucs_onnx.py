#!/usr/bin/env python3
"""
Exporta un core ONNX de HTDemucs para uso browser-side.

Este script no toca el frontend directamente: genera un .onnx y un .json de
metadata que luego se copian a public/models/htdemucs/.

Dependencias sugeridas:
  pip install demucs torch onnx onnxruntime einops

Uso:
  python tools/export_htdemucs_onnx.py --model htdemucs --output public/models/htdemucs/htdemucs.onnx
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from fractions import Fraction
from pathlib import Path

import torch
import torch.nn as nn


class HTDemucsCoreWrapper(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.encoder = model.encoder
        self.decoder = model.decoder
        self.tencoder = model.tencoder
        self.tdecoder = model.tdecoder
        self.crosstransformer = getattr(model, "crosstransformer", None)
        self.freq_emb = getattr(model, "freq_emb", None)
        self.freq_emb_scale = getattr(model, "freq_emb_scale", 0)
        self.bottom_channels = getattr(model, "bottom_channels", 0)
        self.channel_upsampler = getattr(model, "channel_upsampler", None)
        self.channel_downsampler = getattr(model, "channel_downsampler", None)
        self.channel_upsampler_t = getattr(model, "channel_upsampler_t", None)
        self.channel_downsampler_t = getattr(model, "channel_downsampler_t", None)
        self.sources = list(getattr(model, "sources", []))
        self.depth = getattr(model, "depth", len(model.encoder))

    def forward(self, mag, mix):
        from einops import rearrange

        x = mag
        batch_size, _, freq_bins, time_frames = x.shape
        length = mix.shape[-1]

        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)

        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)

        saved = []
        saved_t = []
        lengths = []
        lengths_t = []

        for index, encode in enumerate(self.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if index < len(self.tencoder):
                tenc = self.tencoder[index]
                lengths_t.append(xt.shape[-1])
                xt = tenc(xt)
                if getattr(tenc, "empty", False):
                    inject = xt
                else:
                    saved_t.append(xt)

            x = encode(x, inject)

            if index == 0 and self.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = self.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + self.freq_emb_scale * emb

            saved.append(x)

        if self.crosstransformer:
            if self.bottom_channels:
                _, _, bottom_freq, bottom_time = x.shape
                x = rearrange(x, "b c f t -> b c (f t)")
                x = self.channel_upsampler(x)
                x = rearrange(x, "b c (f t) -> b c f t", f=bottom_freq)
                xt = self.channel_upsampler_t(xt)

            x, xt = self.crosstransformer(x, xt)

            if self.bottom_channels:
                x = rearrange(x, "b c f t -> b c (f t)")
                x = self.channel_downsampler(x)
                x = rearrange(x, "b c (f t) -> b c f t", f=bottom_freq)
                xt = self.channel_downsampler_t(xt)

        for index, decode in enumerate(self.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = self.depth - len(self.tdecoder)
            if index >= offset:
                tdec = self.tdecoder[index - offset]
                length_t = lengths_t.pop(-1)
                if getattr(tdec, "empty", False):
                    pre = pre[:, :, 0]
                    xt, _ = tdec(pre, None, length_t)
                else:
                    skip_t = saved_t.pop(-1)
                    xt, _ = tdec(xt, skip_t, length_t)

        source_count = len(self.sources)
        x = x.view(batch_size, source_count, -1, freq_bins, time_frames)
        x = x * std[:, None] + mean[:, None]

        xt = xt.view(batch_size, source_count, -1, length)
        xt = xt * stdt[:, None] + meant[:, None]
        return x, xt


def compute_segment_samples(model) -> int:
    segment_raw = getattr(model, "segment", Fraction(39, 5))
    samplerate = int(getattr(model, "samplerate", 44100))
    if isinstance(segment_raw, Fraction):
        return int(segment_raw * samplerate)
    return int(round(float(segment_raw) * samplerate))


def build_metadata(model) -> dict:
    samplerate = int(getattr(model, "samplerate", 44100))
    segment_samples = compute_segment_samples(model)
    nfft = int(getattr(model, "nfft", 4096))
    hop_length = int(getattr(model, "hop_length", 1024))
    overlap_samples = int(round(samplerate * 0.75))
    return {
        "model_name": type(model).__name__,
        "samplerate": samplerate,
        "segment_samples": segment_samples,
        "overlap_samples": overlap_samples,
        "hop_length": hop_length,
        "nfft": nfft,
        "num_freq_bins": nfft // 2,
        "spec_time_frames": int(math.ceil(segment_samples / hop_length)),
        "spec_pad": hop_length // 2 * 3,
        "sources": list(getattr(model, "sources", [])),
        "notes": "Generated by tools/export_htdemucs_onnx.py. Review values before shipping to browser.",
    }


def load_demucs_model(model_name: str):
    from demucs.pretrained import get_model

    loaded = get_model(model_name)
    if hasattr(loaded, "models") and loaded.models:
        return loaded.models[0]
    return loaded


def export_model(model_name: str, output_path: Path, meta_path: Path, opset: int) -> None:
    model = load_demucs_model(model_name)
    model.eval()
    model.cpu()

    metadata = build_metadata(model)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    wrapper = HTDemucsCoreWrapper(model)
    wrapper.eval()

    batch = 1
    channels = int(getattr(model, "audio_channels", 2))
    num_freq_bins = metadata["nfft"] // 2
    spec_time_frames = int(math.ceil(metadata["segment_samples"] / metadata["hop_length"]))

    dummy_mag = torch.randn(batch, channels * 2, num_freq_bins, spec_time_frames)
    dummy_mix = torch.randn(batch, channels, metadata["segment_samples"])

    try:
        torch.onnx.export(
            wrapper,
            (dummy_mag, dummy_mix),
            str(output_path),
            input_names=["mag", "mix"],
            output_names=["freq_out", "time_out"],
            opset_version=opset,
            do_constant_folding=True,
        )
    except Exception as exc:
        raise SystemExit(
            "El export HTDemucs ONNX ha fallado con la version local de demucs o por dependencias faltantes.\n"
            f"Detalle: {exc}"
        ) from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Exporta HTDemucs a ONNX core para navegador")
    parser.add_argument("--model", default="htdemucs", choices=["htdemucs", "htdemucs_ft", "htdemucs_6s", "hdemucs_mmi"])
    parser.add_argument("--output", default="public/models/htdemucs/htdemucs.onnx")
    parser.add_argument("--meta", default="public/models/htdemucs/htdemucs.json")
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    export_model(args.model, Path(args.output), Path(args.meta), args.opset)


if __name__ == "__main__":
    main()
