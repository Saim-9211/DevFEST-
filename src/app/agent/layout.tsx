import { requireArea } from "@/lib/auth";

export default async function AgentLayout({ children }: LayoutProps<"/agent">) {
  await requireArea("agent");
  return <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>;
}
