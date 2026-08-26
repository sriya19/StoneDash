import { AlertTriangle } from "lucide-react";

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
    <div className="mb-4 flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800/60 dark:bg-amber-950/30">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="space-y-1">
        <p className="font-medium text-amber-900 dark:text-amber-200">
          ETA is manual for your {installEventCount} scheduled install
          {installEventCount === 1 ? "" : "s"}
        </p>
        {reasons.map((r) => (
          <p key={r} className="text-amber-800 dark:text-amber-300/90">
            {r}
          </p>
        ))}
        <p className="text-amber-800/80 dark:text-amber-300/70">
          Messages still send — you&apos;ll just type the ETA yourself.
        </p>
      </div>
    </div>
  );
}
