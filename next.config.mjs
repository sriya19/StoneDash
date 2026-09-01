/** @type {import('next').NextConfig} */

// Derive the Supabase Storage host from the project URL rather than
// hardcoding a project ref, so switching projects needs no edit here.
// Falls back to a wildcard when the env is absent at build time — a Vercel
// build with envs not yet wired should not hard-fail on this — and a
// malformed URL must not throw inside next.config either.
//
// Note: nothing renders a remote image through next/image today. Every
// uploaded file (file-gallery, file-lightbox, intake-list,
// intake-review-sheet) uses a plain <img>, which bypasses the optimizer
// and this allowlist entirely; the one next/image is the marketing hero
// on a local public/ asset. This is future-proofing, and it becomes
// load-bearing the moment an <img> is swapped for <Image>.
function supabaseImageHost() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "*.supabase.co";
  try {
    return new URL(url).hostname;
  } catch {
    return "*.supabase.co";
  }
}

const supabaseHost = supabaseImageHost();

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/sign/**",
      },
    ],
  },
  experimental: {
    // Required on Next 14 for instrumentation.ts to run at all; the hook
    // became unconditional in Next 15. Without this the mock-in-production
    // startup guard is silently a no-op.
    instrumentationHook: true,
  },
};

export default nextConfig;
