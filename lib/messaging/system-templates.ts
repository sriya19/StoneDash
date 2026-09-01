// The eight templates that ship with the app.
//
// Seeded per-org with is_system_default=true. An org edit inserts nothing
// new at the slug level — it replaces the row for that org (message_templates
// is UNIQUE on (org_id, slug)) — and "reset to default" deletes the org row
// so the canonical copy here can be restored.
//
// Shared between supabase/seed.ts and scripts/test_message_templates.ts so
// the tests exercise the real bodies rather than a drifting copy.

export type TemplateAudience = "crew" | "customer" | "contractor";

export type SystemTemplate = {
  slug: string;
  audience: TemplateAudience;
  title: string;
  body: string;
};

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    slug: "install_eta",
    audience: "customer",
    title: "Install ETA",
    body:
      "Hi {{customer_name}}, we're on our way with your {{stone_type}} " +
      "counters. ETA {{eta_min}} minutes. Any last questions call " +
      "{{shop_phone}}.",
  },
  {
    slug: "measurement_scheduled",
    audience: "customer",
    title: "Measurement Scheduled",
    body:
      "Hi {{customer_name}}, we've got your measurement scheduled for " +
      "{{event_date}} at {{event_time}}. Someone 18+ needs to be home. " +
      "Call {{shop_phone}} if you need to reschedule.",
  },
  {
    slug: "install_scheduled",
    audience: "customer",
    title: "Install Scheduled",
    body:
      "Hi {{customer_name}}, your {{stone_type}} install is scheduled for " +
      "{{event_date}}. We'll text you the morning of with ETA. Please clear " +
      "the workspace and remove valuables from cabinets.",
  },
  {
    // The brief's body referenced {{next_openings}}. Dropped per PLAN.md Q10:
    // "next 3 available install dates" needs a definition of availability
    // (crew capacity, working hours, event density) that does not exist in
    // the schema, and half-building an availability engine inside a template
    // renderer is how the renderer stops being a pure function.
    slug: "ready_for_install",
    audience: "customer",
    title: "Ready to Install",
    body:
      "Hi {{customer_name}}, your counters are fabricated and ready. When " +
      "would you like us to install?",
  },
  {
    // Task 9. Fires on measurement -> fabrication. {{fabrication_days}}
    // resolves from organizations.default_fabrication_days, so it is an
    // org-wide typical rather than a per-order estimate — which is why the
    // sentence says "typical" rather than promising this job's date.
    slug: "in_fabrication",
    audience: "customer",
    title: "In Fabrication",
    body:
      "Hi {{customer_name}}, your {{stone_type}} counters are now being " +
      "fabricated. We'll let you know once they're ready for install — " +
      "typical fabrication is {{fabrication_days}} days.",
  },
  {
    // Task 9. Fires on installation -> invoiced.
    slug: "invoice_sent",
    audience: "customer",
    title: "Invoice Sent",
    body:
      "Hi {{customer_name}}, your invoice for {{project_name}} " +
      "({{balance_due}}) is on its way. Payment methods and details " +
      "inside. Call {{shop_phone}} if anything looks off.",
  },
  {
    slug: "crew_dispatch",
    audience: "crew",
    title: "Install Dispatch",
    body: [
      "📍 {{event_kind}}: {{order_number}} — {{project_name}}",
      "🕐 {{event_datetime}} ({{event_duration}})",
      "📌 {{site_address}}",
      "👤 {{site_contact_name}} — {{site_contact_phone}}",
      "🪨 {{stone_type}}, {{edge_profile}}, {{cutout_summary}}",
      "📝 {{notes}}",
    ].join("\n"),
  },
  {
    slug: "payment_reminder",
    audience: "customer",
    title: "Balance Reminder",
    body:
      "Hi {{customer_name}}, following up on the balance of {{balance_due}} " +
      "for {{project_name}}. Let me know if you have any questions — " +
      "{{shop_phone}}.",
  },
];

/** Look up a shipped template by slug. */
export function systemTemplate(slug: string): SystemTemplate | undefined {
  return SYSTEM_TEMPLATES.find((t) => t.slug === slug);
}
