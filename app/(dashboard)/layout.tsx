import { ensureProjectSelected } from "@/lib/peec-server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureProjectSelected();

  return (
    <div className="flex h-screen bg-white">
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
