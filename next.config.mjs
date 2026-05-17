/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    devtoolSegmentExplorer: false,
    browserDebugInfoInTerminal: false,
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
