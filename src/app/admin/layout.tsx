import { requireArea } from "@/lib/auth";
import { AreaNav } from "@/components/area-nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireArea("admin");
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AreaNav
        links={[
          { href: "/admin", label: "Control room" },
          { href: "/admin/cycles/new", label: "New cycle" },
          { href: "/admin/payments", label: "Payments & cash" },
          { href: "/admin/returns", label: "Returns" },
        ]}
      />
      {children}
    </div>
  );
}
