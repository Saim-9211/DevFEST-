import Link from "next/link";
import { Building2, Gavel, PackageCheck, ShoppingCart, Truck, Users } from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

const stepIcons = [Building2, ShoppingCart, Gavel, PackageCheck];
const roleIcons = [Users, Building2, Truck];

export default async function LandingPage() {
  const { t } = await getDictionary();
  const l = t.landing;

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-soft to-background">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{l.heroTitle}</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{l.heroBody}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClass("primary", "lg")}>
              {l.ctaResident}
            </Link>
            <Link href="/signup?as=supplier" className={buttonClass("secondary", "lg")}>
              {l.ctaSupplier}
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{l.targetNote}</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-semibold">{l.howTitle}</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {l.steps.map((step, i) => {
            const Icon = stepIcons[i];
            return (
              <li key={step.title}>
                <Card className="h-full">
                  <div className="flex items-center gap-2 text-brand">
                    <Icon className="size-5" aria-hidden />
                    <span className="text-sm font-semibold">{i + 1}</span>
                  </div>
                  <h3 className="mt-3 font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                </Card>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <h2 className="text-2xl font-semibold">{l.rolesTitle}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {l.roles.map((role, i) => {
            const Icon = roleIcons[i];
            return (
              <Card key={role.title}>
                <Icon className="size-6 text-brand" aria-hidden />
                <h3 className="mt-3 font-semibold">{role.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{role.body}</p>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
