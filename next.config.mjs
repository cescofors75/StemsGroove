/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  logging: {
    browserToTerminal: false,
  },
  onDemandEntries: {
    // Keep entries alive longer in dev to avoid transient chunk-not-found on Windows.
    maxInactiveAge: 1000 * 60 * 60,
    pagesBufferLength: 10,
  },
  outputFileTracingExcludes: {
    // app/api/separate references .venv/**/python paths at runtime; Turbopack's
    // file tracer can crash walking into the venv's symlinks, so keep it out.
    "*": [".venv/**/*", ".stems/**/*"],
  },
};

export default nextConfig;
