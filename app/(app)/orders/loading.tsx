import { TableSkeleton } from "@/components/app/table-skeleton";

export default function Loading() {
  return <TableSkeleton columns={7} rows={10} />;
}
