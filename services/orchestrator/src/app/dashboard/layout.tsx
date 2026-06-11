// The app shell (top bar + nav) now lives in the root layout (src/app/layout.tsx)
// so it renders on every route. This layout is a pass-through; it exists only as
// a place to add dashboard-scoped wrappers in the future.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
