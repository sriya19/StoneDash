import {
  ClipboardCheck,
  Factory,
  Sparkles,
  Truck,
  Wallet,
} from "lucide-react";
import { addDays, subDays } from "date-fns";
import type { OrderStage } from "@prisma/client";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatInTimeZone, parseLocalDateTime } from "@/lib/tz";
import { KpiCard, type KpiTrend } from "@/components/app/kpi-card";
import {
  PipelineStrip,
  STAGE_ORDER,
  type StageSummary,
} from "@/components/app/pipeline-strip";
import { ActivityFeed, type ActivityRow } from "@/components/app/activity-feed";
import type { ExtractionStatus } from "@/lib/supabase/types";

type OrderForKpis = {
  id: string;
  stage: OrderStage;
  quote_amount: string | null;
  balance_due: string;
  created_at: string;
};

type InstallEvent = {
  id: string;
  order_id: string;
  starts_at: string;
  project_name: string | null;
  stage: OrderStage;
  status: string;
};

type ActivityDbRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  entity_type: string;
  action: string;
  metadata: Record<string, unknown>;
};

type ProfileLookup = { id: string; full_name: string | null };

type ContractorBalanceRow = { balance_owed: string | null };

type ExtractionKpiRow = {
  id: string;
  status: ExtractionStatus;
  cost_cents: number | null;
};

function toNumber(value: string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function firstNameOf(full: string | null | undefined): string | null {
  if (!full) return null;
  const trimmed = full.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

// Compute a window comparison: how many rows fall inside [windowStart,
// now] vs the equal-length window immediately preceding it. Returns a
// signed percent delta, or null when the prior window was empty (no
// meaningful baseline to compare against).
function windowDelta(
  rows: { created_at: string }[],
  windowStartUtc: string,
  priorStartUtc: string,
): number | null {
  const wStart = new Date(windowStartUtc).getTime();
  const wPrior = new Date(priorStartUtc).getTime();
  let current = 0;
  let prior = 0;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (t >= wStart) current += 1;
    else if (t >= wPrior) prior += 1;
  }
  if (prior === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - prior) / prior) * 100);
}

export default async function DashboardPage() {
  const { profile, org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  // Greeting uses the *org's* local hour, not the request server's. Two
  // owners in different time zones logging in should each see the right
  // greeting for their shop.
  const orgHour = Number(formatInTimeZone(new Date(), org.timezone, "H"));
  const firstName = firstNameOf(profile.full_name);
  const greeting = firstName
    ? `${greetingFor(orgHour)}, ${firstName}.`
    : `${greetingFor(orgHour)}.`;

  // "Installs this week" = events in [today 00:00 org-local, today+7
  // 23:59 org-local], expressed as UTC for the query (server-side
  // timezone discipline). We also slice out installs strictly within
  // today's window for the urgent KPI variant + ops summary.
  const todayDateStr = formatInTimeZone(new Date(), org.timezone, "yyyy-MM-dd");
  const sevenDateStr = formatInTimeZone(addDays(new Date(), 7), org.timezone, "yyyy-MM-dd");
  const todayStartUtc = parseLocalDateTime(todayDateStr, "00:00", org.timezone).toISOString();
  const todayEndUtc = parseLocalDateTime(todayDateStr, "23:59:59", org.timezone).toISOString();
  const sevenEndUtc = parseLocalDateTime(sevenDateStr, "23:59:59", org.timezone).toISOString();

  // Trend window: rolling 7 days vs the prior 7 days. We don't track
  // historical stage transitions, so orders.created_at is the proxy for
  // intake velocity — accurate for the directional indicator the brief
  // calls for.
  const sevenDaysBackUtc = subDays(new Date(), 7).toISOString();
  const fourteenDaysBackUtc = subDays(new Date(), 14).toISOString();

  // Current-month lower bound for the AI extractions KPI.
  const monthStartUtc = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  ).toISOString();

  const [ordersRes, installsRes, activityRes, contractorBalRes, extractionsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, stage, quote_amount, balance_due, created_at")
      .returns<OrderForKpis[]>(),
    supabase
      .from("v_calendar_events")
      .select("id, order_id, starts_at, project_name, stage, status")
      .eq("kind", "install")
      .gte("starts_at", todayStartUtc)
      .lte("starts_at", sevenEndUtc)
      .not("status", "in", "(cancelled,no_show,complete)")
      .order("starts_at", { ascending: true })
      .returns<InstallEvent[]>(),
    supabase
      .from("activity_log")
      .select("id, created_at, actor_id, entity_type, action, metadata")
      .order("created_at", { ascending: false })
      .limit(15)
      .returns<ActivityDbRow[]>(),
    supabase
      .from("v_contractor_balances")
      .select("balance_owed")
      .returns<ContractorBalanceRow[]>(),
    // Task 5 — extraction KPI: current month, org-scoped by RLS.
    supabase
      .from("file_extractions")
      .select("id, status, cost_cents")
      .gte("created_at", monthStartUtc)
      .returns<ExtractionKpiRow[]>(),
  ]);

  const orders = ordersRes.data ?? [];
  const installEvents = (installsRes.data ?? []).filter(
    (e) => e.stage !== "cancelled" && e.stage !== "paid",
  );
  const activity = activityRes.data ?? [];
  const contractorBalances = contractorBalRes.data ?? [];
  const extractionsThisMonth = extractionsRes.data ?? [];
  const extractionConfirmed = extractionsThisMonth.filter((e) => e.status === "confirmed").length;
  const extractionPending = extractionsThisMonth.filter((e) => e.status === "review").length;
  const extractionSpendCents = extractionsThisMonth.reduce(
    (s, e) => s + (e.cost_cents ?? 0),
    0,
  );

  // KPI aggregates
  const inFabrication = orders.filter((o) => o.stage === "fabrication");
  const fabSum = inFabrication.reduce((s, o) => s + toNumber(o.quote_amount), 0);

  const awaitingMeasurement = orders.filter(
    (o) => o.stage === "quote" || o.stage === "measurement",
  );

  const outstanding = orders
    .filter((o) => o.stage !== "paid" && o.stage !== "cancelled")
    .reduce((s, o) => s + toNumber(o.balance_due), 0);

  // Ops summary inputs
  const installsToday = installEvents.filter(
    (e) => e.starts_at >= todayStartUtc && e.starts_at <= todayEndUtc,
  );
  const unpaidContractorTotal = contractorBalances.reduce((s, row) => {
    const n = toNumber(row.balance_owed);
    return n > 0 ? s + n : s;
  }, 0);

  // Trend: intake velocity over the trailing 7d window vs the 7d before it.
  const fabTrendDelta = windowDelta(
    orders,
    sevenDaysBackUtc,
    fourteenDaysBackUtc,
  );
  const fabTrend: KpiTrend | null =
    fabTrendDelta === null
      ? null
      : { delta: fabTrendDelta, label: "from last week" };

  // Pipeline strip per-stage aggregates
  const summaries: StageSummary[] = STAGE_ORDER.map((stage) => {
    const rows = orders.filter((o) => o.stage === stage);
    return {
      stage,
      count: rows.length,
      value: rows.reduce((s, r) => s + toNumber(r.quote_amount), 0),
    };
  });

  // Activity actors — fetch in one pass.
  const actorIds = Array.from(
    new Set(activity.map((a) => a.actor_id).filter((x): x is string => Boolean(x))),
  );

  let actorNames = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds)
      .returns<ProfileLookup[]>();
    actorNames = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  }

  const activityItems: ActivityRow[] = activity.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorName: row.actor_id ? actorNames.get(row.actor_id) ?? null : null,
    entityType: row.entity_type,
    action: row.action,
    metadata: row.metadata,
  }));

  // Ops summary: one friendly sentence at the top. Branches by what's
  // actually happening so we don't render "0 installs and $0 in unpaid
  // balances" — that reads as a system message rather than a heads-up.
  const opsSummary = buildOpsSummary({
    installsToday: installsToday.length,
    unpaidContractorTotal,
    currency: org.currency,
    orgName: org.name,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-7 px-6 py-10">
      <header className="space-y-2">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {org.slug}
        </p>
        <h1 className="font-geist text-[28px] font-semibold leading-tight tracking-tight">
          {greeting}
        </h1>
        <p className="text-[15px] text-muted-foreground">{opsSummary}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="In fabrication"
          value={inFabrication.length.toString()}
          sublabel={
            fabSum > 0 ? `${formatMoney(fabSum, org.currency)} quoted` : "No active jobs"
          }
          icon={Factory}
          href="/orders?stage=fabrication"
          trend={fabTrend}
        />
        <KpiCard
          label="Installs this week"
          value={installEvents.length.toString()}
          sublabel={
            installEvents.length === 0
              ? "Nothing scheduled"
              : installEvents
                  .slice(0, 3)
                  .map((o) => o.project_name ?? "Untitled")
                  .join(", ") +
                (installEvents.length > 3
                  ? ` +${installEvents.length - 3} more`
                  : "")
          }
          icon={Truck}
          href="/schedule"
          urgent={installsToday.length > 0}
        />
        <KpiCard
          label="Awaiting measurement"
          value={awaitingMeasurement.length.toString()}
          sublabel={
            awaitingMeasurement.length === 0
              ? "Up to date"
              : `${awaitingMeasurement.length} in quote/measurement`
          }
          icon={ClipboardCheck}
          href="/orders?stage=measurement"
        />
        <KpiCard
          label="Outstanding balance"
          value={formatMoney(outstanding, org.currency)}
          sublabel={outstanding > 0 ? "Across unpaid orders" : "All collected"}
          icon={Wallet}
          href="/orders?stage=invoiced"
        />
        <KpiCard
          label="AI extractions this month"
          value={extractionConfirmed.toString()}
          sublabel={
            extractionsThisMonth.length === 0
              ? "No documents processed yet"
              : `${extractionPending} pending review · ${formatMoney(
                  extractionSpendCents / 100,
                  org.currency,
                )}`
          }
          icon={Sparkles}
          urgent={extractionPending > 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineStrip currency={org.currency} summaries={summaries} />
        </div>
        <div className="lg:col-span-1">
          <ActivityFeed items={activityItems} />
        </div>
      </div>
    </div>
  );
}

function buildOpsSummary(args: {
  installsToday: number;
  unpaidContractorTotal: number;
  currency: string;
  orgName: string;
}): string {
  const { installsToday, unpaidContractorTotal, currency, orgName } = args;
  if (installsToday === 0 && unpaidContractorTotal === 0) {
    return `${orgName} — quiet day. Nothing scheduled, contractor balances clear.`;
  }
  const parts: string[] = [];
  if (installsToday > 0) {
    parts.push(
      `${installsToday} install${installsToday === 1 ? "" : "s"} today`,
    );
  }
  if (unpaidContractorTotal > 0) {
    parts.push(
      `${formatMoney(unpaidContractorTotal, currency)} in unpaid contractor balances`,
    );
  }
  return `Here at ${orgName} you have ${parts.join(" and ")}.`;
}
