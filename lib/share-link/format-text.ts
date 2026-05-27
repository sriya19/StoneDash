// Renders the "send to crew" plain-text block (Task 3 sub-step 9).
//
// Layout from the brief:
//   📍 Install: TM-1042 — Johnson kitchen
//   🕐 Thu, Apr 24 at 10:00 AM (3h)
//   📌 1234 Maple Lane, Falls Church, VA 22041
//   👤 Customer: Sarah Johnson — (703) 555-0142
//   🪨 Calacatta Gold quartzite, mitered edge, 1 sink cutout
//   📝 Customer wants seam on the right. Side gate code 4823.
//   🔗 Details + photos: https://throughstone.app/j/{slug}
//
// Pure function. No DB; the caller passes assembled context.

import { formatInTimeZone } from "@/lib/tz";

const KIND_LABEL: Record<string, string> = {
  measurement: "Measurement",
  install: "Install",
  delivery: "Delivery",
  pickup: "Pickup",
  other: "Event",
};

export type ShareTextContext = {
  kind: string;
  startsAt: string;
  durationMin: number;
  orderNumber: string;
  projectName: string | null;
  location: string | null;
  customerName: string | null;
  customerPhone: string | null;
  stoneType: string | null;
  edgeProfile: string | null;
  sinkCutouts: number;
  cooktopCutouts: number;
  notes: string | null;
  shareUrl: string | null;
};

export function formatShareText(ctx: ShareTextContext, timeZone: string): string {
  const lines: string[] = [];
  const kindLabel = KIND_LABEL[ctx.kind] ?? "Event";
  const titleProject = ctx.projectName ? ` — ${ctx.projectName}` : "";
  lines.push(`📍 ${kindLabel}: ${ctx.orderNumber}${titleProject}`);

  const timeFmt = formatInTimeZone(ctx.startsAt, timeZone, "EEE, MMM d 'at' h:mm a");
  lines.push(`🕐 ${timeFmt} (${durationLabel(ctx.durationMin)})`);

  if (ctx.location) lines.push(`📌 ${ctx.location}`);

  if (ctx.customerName) {
    const phone = ctx.customerPhone ? ` — ${ctx.customerPhone}` : "";
    lines.push(`👤 Customer: ${ctx.customerName}${phone}`);
  }

  const stoneParts: string[] = [];
  if (ctx.stoneType) stoneParts.push(ctx.stoneType);
  if (ctx.edgeProfile) stoneParts.push(`${ctx.edgeProfile} edge`);
  if (ctx.sinkCutouts > 0) {
    stoneParts.push(`${ctx.sinkCutouts} sink cutout${ctx.sinkCutouts === 1 ? "" : "s"}`);
  }
  if (ctx.cooktopCutouts > 0) {
    stoneParts.push(
      `${ctx.cooktopCutouts} cooktop cutout${ctx.cooktopCutouts === 1 ? "" : "s"}`,
    );
  }
  if (stoneParts.length > 0) lines.push(`🪨 ${stoneParts.join(", ")}`);

  if (ctx.notes && ctx.notes.trim()) lines.push(`📝 ${ctx.notes.trim()}`);

  if (ctx.shareUrl) lines.push(`🔗 Details + photos: ${ctx.shareUrl}`);

  return lines.join("\n");
}

function durationLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}
