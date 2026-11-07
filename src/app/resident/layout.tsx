import { requireArea } from "@/lib/auth";

export default async function ResidentLayout({ children }: LayoutProps<"/resident">) {
  await requireArea("resident");
  return <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>;
}
