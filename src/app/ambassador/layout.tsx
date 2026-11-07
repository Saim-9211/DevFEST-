import { requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { AreaNav } from "@/components/area-nav";

export default async function AmbassadorLayout({ children }: LayoutProps<"/ambassador">) {
  await requireArea("ambassador");
  const { t } = await getDictionary();
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <AreaNav
        links={[
          { href: "/ambassador", label: t.ambassador.title },
          { href: "/resident", label: t.resident.title },
        ]}
      />
      {children}
    </div>
  );
}
