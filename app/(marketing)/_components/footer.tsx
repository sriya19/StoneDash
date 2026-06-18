import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60 bg-background px-6 py-12">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <p className="font-geist text-base font-semibold tracking-tight">
            StoneDash
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            The dashboard stone shops actually use.
          </p>
        </div>
        <FooterColumn
          heading="Product"
          links={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Pricing", href: "#" },
            { label: "Changelog", href: "#" },
          ]}
        />
        <FooterColumn
          heading="Company"
          links={[
            { label: "About", href: "#" },
            { label: "Contact", href: "mailto:hello@stonedash.app" },
          ]}
        />
      </div>
      <div className="mx-auto mt-10 max-w-6xl border-t border-border/60 pt-6">
        <p className="text-xs text-muted-foreground">
          © 2026 StoneDash. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p className="font-geist text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {heading}
      </p>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="text-sm text-foreground/80 hover:text-foreground"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
