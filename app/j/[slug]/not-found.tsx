export const dynamic = "force-dynamic";

export default function LinkUnavailable() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="rounded-xl border bg-card p-8 shadow-sm">
        <p className="text-lg font-semibold">This link is no longer active.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask the shop for a new one. Links can be rotated or revoked after
          they&apos;re sent — this one isn&apos;t the current copy.
        </p>
      </div>
    </div>
  );
}
