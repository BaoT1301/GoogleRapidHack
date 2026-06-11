import { ProjectsPanel } from "@/components/projects/ProjectsPanel";

// Isolated route for the Projects + Codebase-KB pipeline (Cloud Infra demo).
// Inherits AppShell + the tRPC/Toast providers from dashboard/layout.tsx.
export default function ProjectsPage() {
  return <ProjectsPanel />;
}
