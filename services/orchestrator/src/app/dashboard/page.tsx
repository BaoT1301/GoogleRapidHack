import { DashboardView } from "@/components/dashboard/DashboardView";

// Auth is enforced by Clerk middleware; the shell (dashboard/layout.tsx) renders
// the top bar + UserButton. This route is the graph list home.
export default function DashboardPage() {
  return <DashboardView />;
}
