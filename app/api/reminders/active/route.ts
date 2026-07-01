// GET /api/reminders/active — returns the bell's active-due list +
// count. Called every 60s / on focus by <ReminderBell>. Cheap: RLS
// scopes to auth.uid() and the `reminders_user_active_idx` index
// makes the lookup near-instant.

import { NextResponse } from "next/server";

import {
  countActiveDueReminders,
  listActiveDueReminders,
} from "@/lib/queries/reminders";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { count: 0, reminders: [] },
      { status: 401 },
    );
  }

  const [count, reminders] = await Promise.all([
    countActiveDueReminders(),
    listActiveDueReminders(),
  ]);

  return NextResponse.json({ count, reminders });
}
