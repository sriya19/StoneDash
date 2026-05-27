import Link from "next/link";
import { Plus } from "lucide-react";

import { getCurrentUserAndOrg } from "@/lib/auth";
import {
  getCrewMemberDetail,
  listCrewMembersWithActivity,
} from "@/lib/queries/crew";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageMembers } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { CrewTable } from "@/components/app/crew-table";
import { NewCrewDialog } from "@/components/app/new-crew-dialog";
import { CrewDetailSheet } from "@/components/app/crew-detail-sheet";

type SearchParams = {
  active?: string;
  q?: string;
  sort?: string;
  dir?: string;
  new?: string;
  id?: string;
};

export const metadata = { title: "Team · Stone & Design Board" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TeamPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // /team is for the people the shop assigns work to. NOT the same as
  // /settings/members (which manages who can log into the app). RBAC for
  // crew CRUD follows the same manager+ rule as contractors — field role
  // can read but not mutate.
  const { role } = await getCurrentUserAndOrg();
  const canManage = canManageMembers(role);

  const activeOnly = searchParams.active !== "0";
  const search = searchParams.q ?? "";
  const showNew = canManage && searchParams.new === "1";
  const detailId =
    searchParams.id && UUID_RE.test(searchParams.id) ? searchParams.id : null;

  const supabase = createSupabaseServerClient();
  const [rows, detail, totals] = await Promise.all([
    listCrewMembersWithActivity({ activeOnly, search }),
    detailId ? getCrewMemberDetail(detailId) : Promise.resolve(null),
    supabase.from("crew_members").select("id", { count: "exact", head: true }),
  ]);

  const totalInOrg = totals.count ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground">
            The crew you assign measurements and installs to. Not Throughstone
            users — for app access see Settings &rarr; Members.
          </p>
        </div>
        {canManage ? (
          <Button asChild size="sm" className="gap-1">
            <Link href="/team?new=1">
              <Plus className="h-4 w-4" /> New crew member
            </Link>
          </Button>
        ) : null}
      </header>

      <CrewTable rows={rows} totalInOrg={totalInOrg} />

      {showNew ? <NewCrewDialog /> : null}
      {detailId ? <CrewDetailSheet crew={detail} /> : null}
    </div>
  );
}
