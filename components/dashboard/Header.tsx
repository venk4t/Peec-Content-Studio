import { SwitchProjectMenu } from "@/components/dashboard/SwitchProjectMenu";

interface HeaderProps {
  projectName?: string;
  projectId?: string | null;
  right?: React.ReactNode;
}

export function Header({ projectName = "", projectId = null, right }: HeaderProps) {
  return (
    <header className="h-12 shrink-0 bg-white border-b border-gray-200 px-3 flex items-center justify-between">
      <div className="flex items-center min-w-0">
        <SwitchProjectMenu projectName={projectName} projectId={projectId} />
      </div>
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </header>
  );
}
