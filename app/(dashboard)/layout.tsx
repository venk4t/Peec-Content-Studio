import { Sidebar } from "@/components/dashboard/Sidebar";
import { ensureProjectSelected } from "@/lib/peec-server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const project = await ensureProjectSelected();

  return (
    <div className="flex h-screen bg-white">
      <Sidebar
        projectName={project.projectName}
        projectId={project.projectId}
      />
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
