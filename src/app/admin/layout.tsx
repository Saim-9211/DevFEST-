import { requireArea } from "@/lib/auth";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireArea("admin");
  return <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>;
}
