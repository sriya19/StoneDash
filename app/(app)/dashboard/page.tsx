import { getCurrentUserAndOrg } from "@/lib/auth";

export default async function DashboardPage() {
  const { org, profile, role } = await getCurrentUserAndOrg();

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {org.slug}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {profile.full_name ?? "—"} · {role}
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        KPIs, pipeline, and activity feed land in sub-step 6.
      </div>
    </div>
  );
}
