# HTDemucs ONNX Browser Notes

This project is prepared for a browser-side HTDemucs ONNX flow, but it does not ship model assets yet.

## Expected assets

Place exported assets under public/models/htdemucs/ and update manifest.json:

- htdemucs.onnx
- htdemucs.json
- manifest.json

## Current frontend expectation

The browser engine in lib/client-demixer.js expects:

- a manifest at /models/htdemucs/manifest.json
- modelUrl pointing to the exported ONNX core
- metaUrl pointing to JSON metadata for sample rate, segment size and frequency layout

## Export direction

A public reference for this route is smartdaze/otowake-oto, which exports an ONNX-compatible HTDemucs core and performs STFT/reconstruction in JavaScript.

Practical requirements for the next implementation step:

1. Export HTDemucs offline from PyTorch to an ONNX core model.
2. Store metadata describing segment length, hop length, FFT size and source order.
3. Implement the JS pipeline in lib/client-demixer.js:
   - audio decode
   - segmentation
   - STFT and magnitude packing
   - ONNX session run
   - mask/reconstruction
   - overlap-add across segments
   - Blob URL generation for vocals, drums, bass and other

## Why assets are not included yet

This repo currently does not contain a verified exported ONNX HTDemucs model or metadata JSON. The frontend is prepared for them, but the actual model export remains an offline step.
