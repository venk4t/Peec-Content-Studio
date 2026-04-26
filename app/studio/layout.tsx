import { QueryProvider } from "@/components/studio/QueryProvider";

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <QueryProvider>{children}</QueryProvider>;
}
