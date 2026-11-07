import { requireArea } from "@/lib/auth";

export default async function SupplierLayout({ children }: LayoutProps<"/supplier">) {
  await requireArea("supplier");
  return <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>;
}
