import { Info } from "lucide-react";

/**
 * Warns that ETA computation is unavailable — but only when it would
 * actually cost the shop something.
 *
 * Gating is deliberately an AND, not an OR: a brand-new account with no
 * install events scheduled has nothing to compute an ETA *for*, so telling
 * it to go configure Google Maps is pure nag. The banner appears once there
 * is real work the missing config would degrade.
 *
 *   installEventCount > 0  AND  (shop address unset OR server key missing)
 *
 * The two causes render distinct copy because they have different fixes —
 * one is a form on this page, the other is an env var and a deploy.
 *
 * Task 8 Q6: this is the app's one true *info* banner and carries the info
 * palette. It reports a state of the system — nothing the user is about to
 * do is at risk. The three remaining amber banners (csv-import-sheet,
 * new-order-dialog, quick-add-order-sheet) stay amber deliberately: each
 * warns about a mistake the user is about to make — a skipped row, a
 * duplicate customer. If amber and blue both meant "notice", amber would
 * stop meaning anything, and the duplicate-customer warning is the exact
 * surface Task 6A built to prevent real data corruption.
 */
export function SettingsEtaBanner({
  installEventCount,
  hasShopAddress,
  hasServerKey,
}: {
  installEventCount: number;
  hasShopAddress: boolean;
  hasServerKey: boolean;
}) {
  if (installEventCount === 0) return null;
  if (hasShopAddress && hasServerKey) return null;

  const reasons: string[] = [];
  if (!hasShopAddress) {
    reasons.push(
      "Set your shop address below to enable automatic ETA computation for customer notifications.",
    );
  }
  if (!hasServerKey) {
    reasons.push(
      "GOOGLE_MAPS_SERVER_KEY is not configured on the server, so drive times can't be looked up. This must be a separate, IP-restricted key — not the browser key used for address autocomplete.",
    );
  }

  return (
    <div className="mb-4 flex gap-3 rounded-md border border-info-border bg-info-muted p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
      <div className="space-y-1">
        <p className="font-medium text-info">
          ETA is manual for your {installEventCount} scheduled install
          {installEventCount === 1 ? "" : "s"}
        </p>
        {reasons.map((r) => (
          <p key={r} className="text-foreground/80">
            {r}
          </p>
        ))}
        <p className="text-foreground/70">
          Messages still send — you&apos;ll just type the ETA yourself.
        </p>
      </div>
    </div>
  );
}
