/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    devtoolSegmentExplorer: false,
    browserDebugInfoInTerminal: false,
  },
  // Cross-origin isolation enables SharedArrayBuffer, which lets onnxruntime-web
  // run HTDemucs on multiple WASM threads (much faster than single-threaded).
  // COEP "credentialless" still allows fetching the cross-origin .onnx model and
  // ORT's CDN wasm without requiring CORP headers on them.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  onDemandEntries: {
    // Keep entries alive longer in dev to avoid transient chunk-not-found on Windows.
    maxInactiveAge: 1000 * 60 * 60,
    pagesBufferLength: 10,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable webpack filesystem cache in dev to reduce stale chunk references.
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
