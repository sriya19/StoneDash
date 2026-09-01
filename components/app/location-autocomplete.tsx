"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

// Google Places location autocomplete (Task 3.1 sub-step 5).
//
// Uses the new google.maps.places.PlaceAutocompleteElement (GA in 2025);
// the legacy google.maps.places.Autocomplete is deprecated and we don't
// use it per PLAN Q8 lock.
//
// Cost note: we only consume the formatted address from the gmp-select
// event (place.formattedAddress). We do NOT call Place Details — that
// would be the paid surface. Autocomplete predictions alone are free
// under the post-March-2025 pricing model. Confirmed in DEVLOG.
//
// Graceful fallback: if NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is missing OR
// the SDK fails to load (offline dev, ad-blocker, restricted referrer),
// render a plain shadcn <Input>. The address still saves; user just
// types it manually. One-time console.warn, dev-only (Task 9 pre-deploy
// pass) so the missing key is visible locally without adding noise to
// production Vercel logs. NODE_ENV is inlined at build time, so the dead
// branch is stripped from the client bundle rather than shipped.
//
// Country restriction: US only (Top Marble's market). Configurable
// later if we onboard non-US shops.

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const REGION = "us";

// Module-scoped to dedupe concurrent loads + repeat mounts.
let loadPromise: Promise<void> | null = null;
let warnedMissingKey = false;

function loadMapsSdk(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("no window"));
  }
  const w = window as unknown as {
    google?: { maps?: { places?: unknown; importLibrary?: (lib: string) => Promise<unknown> } };
  };
  if (w.google?.maps?.places) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    // `loading=async` + `v=weekly` are recommended for the new web
    // component; importLibrary handles further chunking.
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(API_KEY ?? "")}` +
      "&loading=async&v=weekly&libraries=places";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Google Maps SDK failed to load"));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

type Props = {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function LocationAutocomplete({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const wrapperRef = useRef<HTMLDivElement>(null);
  // We only attach the autocomplete once; further value changes from the
  // parent (e.g. "Use customer address" hint) reset the internal element
  // via the imperative .value assignment below.
  const elementRef = useRef<HTMLElement | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [fallback, setFallback] = useState<boolean>(!API_KEY);

  useEffect(() => {
    if (!API_KEY) {
      if (!warnedMissingKey && process.env.NODE_ENV !== "production") {
        warnedMissingKey = true;
        // eslint-disable-next-line no-console
        console.warn(
          "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set — location autocomplete disabled (falling back to plain input).",
        );
      }
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    loadMapsSdk()
      .then(() => {
        if (cancelled || !wrapperRef.current) return;
        const wrapper = wrapperRef.current;
        wrapper.innerHTML = "";

        const el = document.createElement("gmp-place-autocomplete");
        el.setAttribute("included-region-codes", REGION);
        el.setAttribute("requested-language", "en");
        // Match shadcn Input height/spacing via a CSS class on the host;
        // internal styling is constrained but inherits font size from parent.
        el.setAttribute("style", "display:block;width:100%;");
        wrapper.appendChild(el);
        elementRef.current = el;

        // Initial value sync.
        try {
          (el as unknown as { value?: string }).value = value;
        } catch {
          // older builds of the element may not support setting value
          // directly; harmless.
        }

        const handleSelect = (event: Event) => {
          const ev = event as unknown as {
            placePrediction?: { toPlace?: () => { formattedAddress?: string } };
            value?: string;
          };
          let formatted: string | undefined;
          try {
            const place = ev.placePrediction?.toPlace?.();
            formatted = place?.formattedAddress;
          } catch {
            // ignore
          }
          if (!formatted && typeof ev.value === "string") {
            formatted = ev.value;
          }
          if (formatted) onChangeRef.current(formatted);
        };

        // Catch the user's free-text edits (typing without picking from
        // the dropdown). The element fires 'input' on its internal input.
        const handleInput = (event: Event) => {
          const ev = event as unknown as { target?: { value?: string } };
          const next = ev.target?.value;
          if (typeof next === "string") onChangeRef.current(next);
        };

        el.addEventListener("gmp-select", handleSelect);
        el.addEventListener("input", handleInput);
        cleanup = () => {
          el.removeEventListener("gmp-select", handleSelect);
          el.removeEventListener("input", handleInput);
        };
      })
      .catch((err) => {
        if (cancelled) return;
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(
            "Google Maps SDK failed to load — falling back to plain location input.",
            err,
          );
        }
        setFallback(true);
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // We intentionally don't depend on `value` — re-attaching on every
    // keystroke would tear down + recreate the element, losing dropdown
    // state. External value changes (hint click) are handled by the
    // separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push parent's `value` into the live element when it changes (e.g. the
  // "Use customer address" hint sets locationText). Skip when fallback.
  useEffect(() => {
    if (fallback) return;
    const el = elementRef.current;
    if (!el) return;
    try {
      const current = (el as unknown as { value?: string }).value;
      if (current !== value) (el as unknown as { value?: string }).value = value;
    } catch {
      // ignore
    }
  }, [value, fallback]);

  if (fallback) {
    return (
      <Input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }

  return (
    <div
      ref={wrapperRef}
      id={inputId}
      className="rounded-md border bg-background px-2 py-1 [&_input]:bg-transparent [&_input]:outline-none"
      aria-label={placeholder ?? "Location"}
    />
  );
}
