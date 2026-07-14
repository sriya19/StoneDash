import { redirect } from "next/navigation";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { hasAtLeast } from "@/lib/rbac";
import { getIntakeEvent, listRecentIntakes } from "@/lib/queries/intake";
import { createSignedUrl, createSignedUrls } from "@/lib/actions/attachments";
import { IntakeUploader } from "@/components/app/intake-uploader";
import { IntakeList } from "@/components/app/intake-list";
import { IntakeReviewSheet } from "@/components/app/intake-review-sheet";
import type { IntakeExtraction } from "@/lib/intake/types";
import type { IntakeMatches } from "@/lib/intake/match";
import type { Proposal } from "@/lib/intake/propose";

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

      {searchParams.intake ? (
        <IntakeReviewMount intakeId={searchParams.intake} />
      ) : null}
    </div>
  );
}

async function IntakeReviewMount({ intakeId }: { intakeId: string }) {
  // UUID sanity — invalid params silently drop rather than
  // 500'ing on a bad query.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intakeId)) {
    return null;
  }
  const row = await getIntakeEvent(intakeId);
  if (!row) return null;

  const signed = await createSignedUrl(row.storage_path);
  const signedSourceUrl = signed.ok ? signed.url : null;

  // The JSONB payloads carry their real shapes from the pipeline;
  // cast at the boundary so downstream code sees the right types.
  const extraction = (row.extraction ?? null) as IntakeExtraction | null;
  const matches = (row.matches ?? null) as IntakeMatches | null;
  const proposal = (row.proposal ?? null) as Proposal | null;

  return (
    <IntakeReviewSheet
      intakeId={intakeId}
      signedSourceUrl={signedSourceUrl}
      extraction={extraction}
      matches={matches}
      proposal={proposal}
      errorMessage={row.error_message}
    />
  );
}
