import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-2xl text-center space-y-6">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Stone &amp; Design Board
        </p>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-balance">
          The operations dashboard for stone fabrication shops.
        </h1>
        <p className="text-muted-foreground text-lg">
          Track every order from quote to install. Replace the WhatsApp threads,
          paper tickets, and Excel sheets your shop is running on today.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Log in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
