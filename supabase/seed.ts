// supabase/seed.ts — Demo data for Stone & Design Board.
//
// Usage: `pnpm db:seed` (requires NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL in .env.local).
//
// Idempotent: deletes the 'top-marble-granite' org and the
// owner@topmarble.local auth user if they already exist, then rebuilds
// everything fresh. Triggers handle activity_log + order_stage_history.

import { createClient } from "@supabase/supabase-js";
import type {
  Contractor,
  CrewMember,
  OrderPriority,
  OrderStage,
} from "@prisma/client";
import { prisma } from "../lib/db";
import { generateShareLinkSlug } from "../lib/share-link/slug";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_EMAIL = "owner@topmarble.local";
const DEMO_PASSWORD = "StoneDemo!2026";
const FIELD_EMAIL = "field@topmarble.local";
const FIELD_PASSWORD = "StoneDemo!2026";
const DEMO_ORG_SLUG = "top-marble-granite";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local",
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Date `offsetDays` days from today (midnight UTC to keep @db.Date stable).
function d(offsetDays: number): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now;
}

type CustomerSeed = {
  name: string;
  company: string | null;
  email: string;
  phone: string;
  city: string;
  state: string;
};

type OrderSeed = {
  customerIndex: number;
  contractorIndex?: number;
  projectName: string;
  stage: OrderStage;
  priority: OrderPriority;
  stoneType: string;
  edgeProfile: string;
  sinkCutouts?: number;
  cooktopCutouts?: number;
  estimatedSqft: number;
  quoteAmount: number;
  depositReceived: number;
  measuredAt?: Date | null;
  fabricationStartDate?: Date | null;
  scheduledInstallDate?: Date | null;
  installedAt?: Date | null;
  notes?: string;
};

type ContractorSeed = {
  name: string;
  primaryContact: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  paymentTerms: string;
  notes?: string;
};

async function findUserByEmail(email: string): Promise<string | null> {
  // listUsers is paginated; the seed addresses are unique so the first page suffices.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const existing = data.users.find((u) => u.email === email);
  return existing?.id ?? null;
}

async function resetDemoData() {
  // Delete organization (cascades to members, customers, orders, attachments,
  // stage history, activity log, order seq, crew, events, share links).
  await prisma.organization.deleteMany({ where: { slug: DEMO_ORG_SLUG } });

  for (const email of [DEMO_EMAIL, FIELD_EMAIL]) {
    const id = await findUserByEmail(email);
    if (id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
    }
  }
}

async function main() {
  await resetDemoData();

  // 1. Demo auth user
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Demo Owner" },
  });
  if (createErr || !created.user) {
    throw createErr ?? new Error("admin.createUser returned no user");
  }
  const userId = created.user.id;

  // 2. Organization
  const org = await prisma.organization.create({
    data: {
      name: "Top Marble & Granite",
      slug: DEMO_ORG_SLUG,
      orderPrefix: "TM",
      orderSeqStart: 1042,
      ownerId: userId,
      timezone: "America/New_York",
      currency: "USD",
    },
  });

  // 3. Profile + owner membership
  await prisma.profile.create({
    data: {
      id: userId,
      fullName: "Demo Owner",
      activeOrgId: org.id,
      theme: "light",
    },
  });

  await prisma.orgMember.create({
    data: {
      orgId: org.id,
      userId,
      role: "owner",
      inviteAcceptedAt: new Date(),
    },
  });

  // 3b. Field-role demo user — for trying the app as an installer without
  // admin privileges. Same shop; role=field. Used by the scheduling RLS
  // smoke (sub-step 1) and the future /j/[slug] flow when the installer
  // wants to mark "en route" / "complete" without leaving the app.
  const { data: fieldCreated, error: fieldErr } = await admin.auth.admin.createUser({
    email: FIELD_EMAIL,
    password: FIELD_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Demo Field Tech" },
  });
  if (fieldErr || !fieldCreated.user) {
    throw fieldErr ?? new Error("field admin.createUser returned no user");
  }
  const fieldUserId = fieldCreated.user.id;
  await prisma.profile.create({
    data: {
      id: fieldUserId,
      fullName: "Demo Field Tech",
      activeOrgId: org.id,
      theme: "light",
    },
  });
  await prisma.orgMember.create({
    data: {
      orgId: org.id,
      userId: fieldUserId,
      role: "field",
      inviteAcceptedAt: new Date(),
    },
  });

  // 4. Customers
  const customerSeeds: CustomerSeed[] = [
    { name: "Sarah Chen",        company: "Chen Design Build",         email: "sarah@chendesign.example",  phone: "(555) 201-3344", city: "Brooklyn",      state: "NY" },
    { name: "Michael Rodriguez", company: null,                        email: "mrodriguez@example.com",    phone: "(555) 318-7712", city: "Queens",        state: "NY" },
    { name: "Jennifer Park",     company: "Park & Associates Kitchens", email: "jen@parkkitchens.example", phone: "(555) 662-0199", city: "Manhattan",     state: "NY" },
    { name: "David Thompson",    company: null,                        email: "dthompson@example.com",     phone: "(555) 409-2233", city: "Staten Island", state: "NY" },
    { name: "Linda Osei",        company: "Osei Interiors",            email: "linda@oseiinteriors.example", phone: "(555) 881-5521", city: "Bronx",       state: "NY" },
    { name: "Paul Nakamura",     company: null,                        email: "pnakamura@example.com",     phone: "(555) 774-8820", city: "Jersey City",   state: "NJ" },
    { name: "Grace Martinelli",  company: "Martinelli Custom Homes",   email: "grace@martinellihomes.example", phone: "(555) 223-9901", city: "Hoboken",  state: "NJ" },
    { name: "Terrence Whitfield", company: null,                       email: "twhitfield@example.com",    phone: "(555) 610-4477", city: "Newark",        state: "NJ" },
  ];

  const customers = [];
  for (const c of customerSeeds) {
    const row = await prisma.customer.create({
      data: { ...c, orgId: org.id, createdBy: userId },
    });
    customers.push(row);
  }

  // 5. Contractors
  //
  // Three contractors with distinct payment-terms shapes so the list page
  // shows variety: Ameer runs a tab (frequent partial payments), Khaled
  // pays Net 30 per job, Dulles is Net 60.
  const contractorSeeds: ContractorSeed[] = [
    {
      name: "Ameer Construction",
      primaryContact: "Ameer Hassan",
      phone: "(555) 901-2211",
      email: "ameer@ameerconstruction.example",
      city: "Falls Church",
      state: "VA",
      paymentTerms: "Running tab",
      notes: "Pays weekly-ish against whatever is open. Keeps a running tab.",
    },
    {
      name: "Khaled Kitchens & Bath",
      primaryContact: "Khaled Nassar",
      phone: "(555) 812-3344",
      email: "khaled@khaledkitchens.example",
      city: "Arlington",
      state: "VA",
      paymentTerms: "Net 30",
    },
    {
      name: "Dulles Build Group",
      primaryContact: "Priya Patel",
      phone: "(555) 223-7788",
      email: "priya@dullesbuild.example",
      city: "Sterling",
      state: "VA",
      paymentTerms: "Net 60",
      notes: "New relationship — slower to pay but reliable.",
    },
  ];

  const contractors: Contractor[] = [];
  for (const c of contractorSeeds) {
    const row = await prisma.contractor.create({
      data: { ...c, orgId: org.id, createdBy: userId },
    });
    contractors.push(row);
  }

  // 5b. Crew members
  //
  // 5 people across the four roles that show up on a stone-shop calendar.
  // Lead installers run installs; helpers ride along; fabricator handles
  // template + finish work; measurement tech goes to homes first. Order
  // matters: the assignment block below references `crewMembers[0..3]`.
  const crewSeeds = [
    { name: "Carlos Mendez", role: "Lead Installer",   phone: "(703) 555-0101", email: "carlos@topmarble.local" },
    { name: "Mike Thompson", role: "Lead Installer",   phone: "(703) 555-0102", email: "mike@topmarble.local" },
    { name: "Jorge Ramirez", role: "Helper",           phone: "(703) 555-0103", email: null },
    { name: "David Park",    role: "Fabricator",       phone: "(703) 555-0104", email: null },
    { name: "Ana Vasquez",   role: "Measurement Tech", phone: "(703) 555-0105", email: "ana@topmarble.local" },
  ];

  const crewMembers: CrewMember[] = [];
  for (const c of crewSeeds) {
    const row = await prisma.crewMember.create({
      data: { ...c, orgId: org.id, createdBy: userId },
    });
    crewMembers.push(row);
  }

  // 6. Orders
  const orderSeeds: OrderSeed[] = [
    {
      customerIndex: 0,
      projectName: "Chen kitchen — island + perimeter",
      stage: "quote",
      priority: "normal",
      stoneType: "Calacatta Gold (marble)",
      edgeProfile: "Eased",
      sinkCutouts: 1,
      cooktopCutouts: 1,
      estimatedSqft: 62,
      quoteAmount: 8450,
      depositReceived: 0,
      notes: "Sent quote; waiting on confirmation.",
    },
    {
      customerIndex: 1,
      contractorIndex: 0,
      projectName: "Rodriguez master bath vanity",
      stage: "measurement",
      priority: "normal",
      stoneType: "Carrara Venato (marble)",
      edgeProfile: "Bevel",
      sinkCutouts: 2,
      estimatedSqft: 18,
      quoteAmount: 2600,
      depositReceived: 1300,
      measuredAt: d(-2),
      scheduledInstallDate: d(12),
    },
    {
      customerIndex: 2,
      contractorIndex: 0,
      projectName: "Park kitchen remodel — Queens townhouse",
      stage: "fabrication",
      priority: "high",
      stoneType: "Taj Mahal Quartzite",
      edgeProfile: "Eased",
      sinkCutouts: 1,
      cooktopCutouts: 1,
      estimatedSqft: 74,
      quoteAmount: 11200,
      depositReceived: 5600,
      measuredAt: d(-8),
      fabricationStartDate: d(-1),
      scheduledInstallDate: d(6),
      notes: "Slab approved. Waterfall on island.",
    },
    {
      customerIndex: 3,
      contractorIndex: 1,
      projectName: "Thompson laundry + mud room tops",
      stage: "fabrication",
      priority: "low",
      stoneType: "Cambria Brittanicca (quartz)",
      edgeProfile: "Eased",
      sinkCutouts: 1,
      estimatedSqft: 28,
      quoteAmount: 3400,
      depositReceived: 1700,
      measuredAt: d(-6),
      fabricationStartDate: d(0),
      scheduledInstallDate: d(9),
    },
    {
      customerIndex: 4,
      projectName: "Osei kitchen + back bar",
      stage: "ready_for_install",
      priority: "normal",
      stoneType: "Absolute Black Granite",
      edgeProfile: "Ogee",
      sinkCutouts: 1,
      cooktopCutouts: 1,
      estimatedSqft: 88,
      quoteAmount: 9900,
      depositReceived: 4950,
      measuredAt: d(-14),
      fabricationStartDate: d(-7),
      scheduledInstallDate: d(2),
      notes: "Polishing complete; seams verified.",
    },
    {
      customerIndex: 5,
      contractorIndex: 1,
      projectName: "Nakamura wet bar",
      stage: "installation",
      priority: "normal",
      stoneType: "Calacatta Quartz (Caesarstone)",
      edgeProfile: "Mitered 1-1/2\"",
      sinkCutouts: 1,
      estimatedSqft: 22,
      quoteAmount: 3100,
      depositReceived: 1550,
      measuredAt: d(-12),
      fabricationStartDate: d(-5),
      scheduledInstallDate: d(0),
    },
    {
      customerIndex: 6,
      projectName: "Martinelli spec home kitchen",
      stage: "installation",
      priority: "rush",
      stoneType: "Pental Quartz Super White",
      edgeProfile: "Eased",
      sinkCutouts: 1,
      cooktopCutouts: 1,
      estimatedSqft: 65,
      quoteAmount: 7200,
      depositReceived: 3600,
      measuredAt: d(-16),
      fabricationStartDate: d(-9),
      scheduledInstallDate: d(-1),
      notes: "Install delayed one day; rescheduled.",
    },
    {
      customerIndex: 7,
      contractorIndex: 2,
      projectName: "Whitfield kitchen reno",
      stage: "invoiced",
      priority: "normal",
      stoneType: "Silestone Eternal Calacatta Gold",
      edgeProfile: "Eased",
      sinkCutouts: 1,
      cooktopCutouts: 1,
      estimatedSqft: 58,
      quoteAmount: 7850,
      depositReceived: 3925,
      measuredAt: d(-26),
      fabricationStartDate: d(-18),
      scheduledInstallDate: d(-7),
      installedAt: d(-6),
      notes: "Invoiced; final payment due.",
    },
    {
      customerIndex: 2,
      projectName: "Park rental unit bathroom",
      stage: "paid",
      priority: "normal",
      stoneType: "Carrara Venato (marble)",
      edgeProfile: "Eased",
      sinkCutouts: 1,
      estimatedSqft: 14,
      quoteAmount: 1950,
      depositReceived: 1950,
      measuredAt: d(-35),
      fabricationStartDate: d(-28),
      scheduledInstallDate: d(-18),
      installedAt: d(-17),
      notes: "Paid in full. Repeat customer.",
    },
    {
      customerIndex: 0,
      projectName: "Chen powder room — cancelled",
      stage: "cancelled",
      priority: "low",
      stoneType: "Calacatta Gold (marble)",
      edgeProfile: "Eased",
      sinkCutouts: 1,
      estimatedSqft: 8,
      quoteAmount: 1100,
      depositReceived: 0,
      notes: "Customer chose another fabricator; kept for history.",
    },
  ];

  // Track inserted order ids by their index in orderSeeds so payment
  // allocations can reference them.
  const orderIds: string[] = [];
  for (const seed of orderSeeds) {
    const rows = await prisma.$queryRaw<{ order_number: string }[]>`
      SELECT generate_order_number(${org.id}::uuid) AS order_number
    `;
    const orderNumber = rows[0]?.order_number;
    if (!orderNumber) throw new Error("generate_order_number returned no row");

    const customer = customers[seed.customerIndex];
    if (!customer) throw new Error(`no customer at index ${seed.customerIndex}`);

    const contractor =
      seed.contractorIndex !== undefined ? contractors[seed.contractorIndex] : null;
    if (seed.contractorIndex !== undefined && !contractor) {
      throw new Error(`no contractor at index ${seed.contractorIndex}`);
    }

    const created = await prisma.order.create({
      data: {
        orgId: org.id,
        orderNumber,
        customerId: customer.id,
        contractorId: contractor?.id ?? null,
        projectName: seed.projectName,
        stage: seed.stage,
        priority: seed.priority,
        stoneType: seed.stoneType,
        edgeProfile: seed.edgeProfile,
        sinkCutouts: seed.sinkCutouts ?? 0,
        cooktopCutouts: seed.cooktopCutouts ?? 0,
        estimatedSqft: seed.estimatedSqft,
        quoteAmount: seed.quoteAmount,
        depositReceived: seed.depositReceived,
        measuredAt: seed.measuredAt ?? null,
        fabricationStartDate: seed.fabricationStartDate ?? null,
        scheduledInstallDate: seed.scheduledInstallDate ?? null,
        installedAt: seed.installedAt ?? null,
        notes: seed.notes ?? null,
        createdBy: userId,
        assignedTo: userId,
      },
    });
    orderIds.push(created.id);
  }

  // 7. Contractor payments + allocations
  //
  // NOTE — we insert via Prisma (service-role / superuser) here, which
  // bypasses the RPC-only write guard. That means the sum-invariant is
  // NOT enforced at insert time during seeding; amounts below must be
  // hand-matched. The RPCs and the direct-write lockdown are exercised
  // by scripts/smoke_contractors_rls.ts and by the in-app flow.
  function orderAt(idx: number): string {
    const id = orderIds[idx];
    if (!id) throw new Error(`no order id at index ${idx}`);
    return id;
  }
  function contractorAt(idx: number): string {
    const row = contractors[idx];
    if (!row) throw new Error(`no contractor at index ${idx}`);
    return row.id;
  }

  // Ameer: $6,000 check split across his 2 orders — partial, leaves a
  // running balance ($7,800 still owed). Matches the "tab" payment-terms
  // style.
  const ameerPayment = await prisma.contractorPayment.create({
    data: {
      orgId: org.id,
      contractorId: contractorAt(0),
      amount: 6000,
      receivedOn: d(-10),
      method: "check",
      reference: "#2847",
      notes: "Partial — covers Rodriguez bath and starts down Park kitchen.",
      createdBy: userId,
    },
  });
  // orderIds index mirrors orderSeeds index: 1 = Rodriguez, 2 = Park.
  await prisma.contractorPaymentAllocation.createMany({
    data: [
      { paymentId: ameerPayment.id, orderId: orderAt(1), amount: 1500 },
      { paymentId: ameerPayment.id, orderId: orderAt(2), amount: 4500 },
    ],
  });

  // Khaled: $3,100 ACH that fully covers Nakamura wet bar. Second order
  // (Thompson laundry) remains fully unpaid. Matches the "pay per job
  // on delivery" Net-30 rhythm.
  const khaledPayment = await prisma.contractorPayment.create({
    data: {
      orgId: org.id,
      contractorId: contractorAt(1),
      amount: 3100,
      receivedOn: d(-5),
      method: "ach",
      reference: "ACH-778812",
      notes: "Nakamura wet bar — paid in full on install.",
      createdBy: userId,
    },
  });
  await prisma.contractorPaymentAllocation.create({
    data: { paymentId: khaledPayment.id, orderId: orderAt(5), amount: 3100 },
  });

  // Dulles: no payments yet. Their 1 order (Whitfield) is fully owed,
  // which gives the contractor detail page a pristine "all outstanding"
  // render to demo the Net-60 slow-pay case.

  // 8. Crew assignments + share links
  //
  // The 0015 bridge trigger created an order_events row (kind=install) for
  // every order with scheduled_install_date set, at 10 AM org-local. We
  // assign Carlos + Jorge to the next 3 upcoming installs; Mike + David to
  // the 4th; the rest stay unassigned so the "no crew yet" empty state has
  // a demo surface.
  const upcomingInstalls = await prisma.orderEvent.findMany({
    where: {
      orgId: org.id,
      kind: "install",
      startsAt: { gte: new Date() },
    },
    orderBy: { startsAt: "asc" },
  });

  const [carlos, mike, jorge, david] = crewMembers;
  if (!carlos || !mike || !jorge || !david) {
    throw new Error("crewMembers missing expected entries");
  }

  async function assign(eventId: string, crew: CrewMember[]) {
    for (const member of crew) {
      await prisma.orderEventAssignment.create({
        data: { eventId, crewMemberId: member.id, role: member.role ?? null },
      });
    }
  }

  for (let i = 0; i < Math.min(3, upcomingInstalls.length); i++) {
    const ev = upcomingInstalls[i];
    if (ev) await assign(ev.id, [carlos, jorge]);
  }
  if (upcomingInstalls[3]) {
    await assign(upcomingInstalls[3].id, [mike, david]);
  }

  // Two share links: one live (resolved by smoke /j/:slug-valid) and one
  // revoked (resolved by smoke /j/:slug-revoked). They cover the matrix
  // described in PLAN ADD-1.
  let linksCreated = 0;
  if (upcomingInstalls[0]) {
    await prisma.eventShareLink.create({
      data: {
        orgId: org.id,
        eventId: upcomingInstalls[0].id,
        slug: generateShareLinkSlug(),
        createdBy: userId,
      },
    });
    linksCreated++;
  }
  if (upcomingInstalls[1]) {
    await prisma.eventShareLink.create({
      data: {
        orgId: org.id,
        eventId: upcomingInstalls[1].id,
        slug: generateShareLinkSlug(),
        createdBy: userId,
        revokedAt: new Date(),
      },
    });
    linksCreated++;
  }

  // eslint-disable-next-line no-console
  console.warn(
    `Seed complete. Demo logins:\n` +
      `  owner:  ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n` +
      `  field:  ${FIELD_EMAIL} / ${FIELD_PASSWORD}\n` +
      `Org: ${org.name} (slug=${org.slug}, prefix=${org.orderPrefix}).\n` +
      `${customers.length} customers, ${contractors.length} contractors, ` +
      `${orderSeeds.length} orders, 2 contractor payments, ` +
      `${crewMembers.length} crew, ${upcomingInstalls.length} upcoming installs, ` +
      `${linksCreated} share links.`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
