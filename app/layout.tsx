import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Inter — body. Already in place from Task 1.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Geist — headings + wordmark. New in Task 4 sub-step 2. Next 14.2's
// `next/font/google` doesn't have Geist yet (it was donated to Google
// Fonts after that build); the `geist` npm package that Vercel
// publishes is the working alternative for now. PLAN.md Q9 anticipated
// this fallback.
//
// GeistSans already exposes `.variable` and the right weights. We rebind
// it to `--font-geist` via a CSS variable on the body className below.

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: {
    default: "StoneDash",
    template: "%s · StoneDash",
  },
  description:
    "The dashboard stone shops actually use. Track every order, manage contractor payments, dispatch your crew.",
  applicationName: "StoneDash",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", sizes: "any" }],
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "StoneDash",
    description:
      "The dashboard stone shops actually use. Track every order, manage contractor payments, dispatch your crew.",
    siteName: "StoneDash",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "StoneDash",
    description: "The dashboard stone shops actually use.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${GeistSans.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <NuqsAdapter>{children}</NuqsAdapter>
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
