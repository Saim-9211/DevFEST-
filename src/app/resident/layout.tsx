import { isAmbassador, requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { AreaNav } from "@/components/area-nav";

export default async function ResidentLayout({ children }: LayoutProps<"/resident">) {
  const ctx = await requireArea("resident");
  const { t } = await getDictionary();
  const links = [
    { href: "/resident", label: t.resident.title },
    { href: "/resident/catalog", label: t.catalog.title },
    { href: "/resident/basket", label: t.basket.title },
    { href: "/resident/order", label: t.order.title },
  ];
  if (isAmbassador(ctx)) links.push({ href: "/ambassador", label: t.ambassador.title });
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <AreaNav links={links} />
      {children}
    </div>
  );
}
