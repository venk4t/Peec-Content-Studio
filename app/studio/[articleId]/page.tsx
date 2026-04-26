import { StudioWorkspace } from "@/components/studio/StudioWorkspace";

export default async function StudioPage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { articleId } = await params;
  return <StudioWorkspace articleId={articleId} />;
}
