import { getCurrentUserAndOrg } from "@/lib/auth";

// (app) layout — gate for every authenticated, org-required page. The real
// sidebar/top-bar shell lands here in sub-step 5; for now this just forces
// auth + active-org resolution so child routes can rely on it.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await getCurrentUserAndOrg();
  return <div className="min-h-screen bg-background">{children}</div>;
}
