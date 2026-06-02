import { MapPin } from "lucide-react";

import { cn } from "@/lib/utils";

// Open-in-Maps link buttons (Task 3.1 sub-step 6). Pure string templates,
// no API calls. Renders Google + Apple side-by-side per PLAN Q9 lock —
// no UA sniffing, the user picks the one they prefer.

type Props = {
  location: string | null | undefined;
  className?: string;
  // "inline" — small, paired text links with the maps icon (default;
  //            used in dialog / table cells / list rows).
  // "buttons" — bordered chip-style buttons (used on the /j/[slug]
  //             public page where the crew taps with their thumb).
  variant?: "inline" | "buttons";
};

export function MapsLinks({ location, className, variant = "inline" }: Props) {
  if (!location || !location.trim()) return null;
  const encoded = encodeURIComponent(location.trim());
  const google = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  const apple = `https://maps.apple.com/?q=${encoded}`;

  if (variant === "buttons") {
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        <a
          href={google}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:bg-accent"
        >
          <MapPin className="h-3 w-3" />
          Google Maps
        </a>
        <a
          href={apple}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:bg-accent"
        >
          <MapPin className="h-3 w-3" />
          Apple Maps
        </a>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 text-[11px]", className)}>
      <a
        href={google}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-brand hover:underline"
      >
        <MapPin className="h-3 w-3" /> Google
      </a>
      <span className="text-muted-foreground/40">·</span>
      <a
        href={apple}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-brand hover:underline"
      >
        <MapPin className="h-3 w-3" /> Apple
      </a>
    </div>
  );
}
