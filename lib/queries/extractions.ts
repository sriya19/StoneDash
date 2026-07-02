import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FileExtractionRow } from "@/lib/supabase/types";

export type FileExtractionDetail = FileExtractionRow & {
  file: {
    id: string;
    order_id: string;
    storage_path: string;
    original_name: string | null;
    mime: string | null;
  };
  order: {
    id: string;
    order_number: string;
    project_name: string | null;
    stone_type: string | null;
    edge_profile: string | null;
    sink_cutouts: number;
    cooktop_cutouts: number;
    quote_amount: string | null;
    deposit_received: string;
    scheduled_install_date: string | null;
    notes: string | null;
  } | null;
};

// Full detail load used by the review sheet. Joins the file +
// parent order so the "will overwrite from X to Y" preview has
// something to render.
export async function getExtractionForFile(
  fileId: string,
): Promise<FileExtractionDetail | null> {
  const supabase = createSupabaseServerClient();

  const { data: extraction } = await supabase
    .from("file_extractions")
    .select("*")
    .eq("file_id", fileId)
    .maybeSingle<FileExtractionRow>();
  if (!extraction) return null;

  const { data: file } = await supabase
    .from("order_attachments")
    .select("id, order_id, storage_path, original_name, mime")
    .eq("id", fileId)
    .maybeSingle<{
      id: string;
      order_id: string;
      storage_path: string;
      original_name: string | null;
      mime: string | null;
    }>();
  if (!file) return null;

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, project_name, stone_type, edge_profile, sink_cutouts, cooktop_cutouts, quote_amount, deposit_received, scheduled_install_date, notes",
    )
    .eq("id", file.order_id)
    .maybeSingle<FileExtractionDetail["order"]>();

  return { ...extraction, file, order };
}
