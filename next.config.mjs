/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Required on Next 14 for instrumentation.ts to run at all; the hook
    // became unconditional in Next 15. Without this the mock-in-production
    // startup guard is silently a no-op.
    instrumentationHook: true,
  },
};

export default nextConfig;
