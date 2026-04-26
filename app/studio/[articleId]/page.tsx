import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { getActionsStatus } from "@/lib/peec";
import { ensureProjectSelected } from "@/lib/peec-server";

export default async function StudioPage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { articleId } = await params;
  const project = await ensureProjectSelected();
  const { items = [] } = getActionsStatus(project.projectId);
  const action = items.find((a) => a.id === articleId);

  return (
    <StudioWorkspace 
      articleId={articleId} 
      actionText={action?.text || ""} 
      brandName={project.projectName}
    />
  );
}
