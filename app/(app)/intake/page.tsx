import { redirect } from "next/navigation";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { hasAtLeast } from "@/lib/rbac";
import { listRecentIntakes } from "@/lib/queries/intake";
import { createSignedUrls } from "@/lib/actions/attachments";
import { IntakeUploader } from "@/components/app/intake-uploader";
import { IntakeList } from "@/components/app/intake-list";

export const metadata = { title: "AI Intake" };

type SearchParams = { intake?: string };

export default async function IntakePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { org, role } = await getCurrentUserAndOrg();

  // Manager+ per PLAN Q11 — field users can't upload / confirm /
  // discard. If they land here we send them to the dashboard.
  if (!hasAtLeast(role, "manager")) {
    redirect("/dashboard");
  }

  const rows = await listRecentIntakes();

  // Batch-sign thumbnail URLs. Each intake row stores a
  // storage_path under {org}/intake/... — same bucket as
  // attachments, so createSignedUrls handles it.
  const paths = rows.map((r) => r.storage_path);
  const signed = paths.length > 0 ? await createSignedUrls(paths, 60 * 60) : {};
  const thumbs: Record<string, string | null> = {};
  for (const row of rows) thumbs[row.id] = signed[row.storage_path] ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="font-geist text-[24px] font-semibold tracking-tight">
          AI Intake
        </h1>
        <p className="text-sm text-muted-foreground">
          Drop screenshots of WhatsApp threads, emails, or SMS conversations.
          The AI reads each one, matches to existing customers / orders, and
          proposes actions for you to confirm.
        </p>
      </header>

      <IntakeUploader orgId={org.id} />

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Recent intakes
        </p>
        <IntakeList rows={rows} thumbs={thumbs} />
      </div>

      {/* Sub-step 9 mounts <IntakeReviewSheet> here when
          ?intake=<id> is set. */}
      {searchParams.intake ? (
        <p className="text-xs text-muted-foreground">
          Review sheet lands in sub-step 9.
        </p>
      ) : null}
    </div>
  );
}
