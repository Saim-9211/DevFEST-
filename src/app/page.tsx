import Link from "next/link";
import {
  BadgeCheck,
  Banknote,
  Building2,
  Camera,
  CheckCircle2,
  KeyRound,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Store,
  TrendingDown,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import { basketTotals, depositSplit } from "@/lib/pricing";
import { formatPKR, formatPct } from "@/lib/utils";
import { ProgressBar } from "@/components/progress";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";

const stepIcons = [ShoppingCart, Building2, Store, KeyRound];
const problemIcons = [TrendingDown, Users, Truck];
const trustIcons = [RotateCcw, Wallet, Banknote, Camera, BadgeCheck, ShieldCheck];
const roleIcons = [Users, Building2, Truck];

// Sample basket at the seeded offer prices (illustrative; matches supabase/seed.sql).
// [retail line total, CollectiveCart line total], same order as `exampleItems`.
const EXAMPLE: [number, number][] = [
  [3000, 2520],
  [2100, 1764],
  [680, 544],
  [760, 608],
  [1550, 1334],
  [2900, 2755],
  [1650, 1568],
  [1980, 1884],
  [1350, 1256],
];

export default async function LandingPage() {
  const { t, locale } = await getDictionary();
  const l = t.landing;
  const totals = basketTotals(EXAMPLE.map(([retail, ours]) => ({ qty: 1, unit_price: ours, retail_price: retail })));
  const split = depositSplit(totals.total, 20);
  const pkr = (n: number) => formatPKR(n, locale);

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-soft to-background">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:py-20 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <Badge tone="brand">{l.heroBadge}</Badge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{l.heroTitle}</h1>
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

          {/* Illustrative building progress + basket summary */}
          <Card className="space-y-4 p-6 shadow-lg" aria-hidden>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 font-semibold">
                <Building2 className="size-5 text-brand" />
                Clifton Towers
              </p>
              <Badge tone="brand">{t.cycleStatus.open}</Badge>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t.resident.buildingProgress}</span>
                <span>
                  9/8 {t.resident.households} · {pkr(131000)}
                </span>
              </div>
              <ProgressBar value={1} />
              <p className="flex items-center gap-1.5 text-sm text-brand">
                <CheckCircle2 className="size-4" />
                {t.resident.progressMet}
              </p>
            </div>
            <div className="rounded-lg bg-muted p-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{l.exampleRetail}</span>
                <span className="line-through">{pkr(totals.retail)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="font-medium">{l.exampleOurs}</span>
                <span className="text-xl font-bold">{pkr(totals.total)}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm font-semibold text-brand">
                <span>{l.exampleSave}</span>
                <span>
                  {pkr(totals.savings)} ({formatPct(totals.savingsPct)})
                </span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-card">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 lg:grid-cols-4">
          {l.stats.map((s) => (
            <div key={s.label}>
              <dt className="sr-only">{s.label}</dt>
              <dd className="text-3xl font-bold text-brand">{s.value}</dd>
              <dd className="mt-1 text-sm text-muted-foreground">{s.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold sm:text-3xl">{l.problemTitle}</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">{l.problemBody}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {l.problems.map((p, i) => {
            const Icon = problemIcons[i];
            return (
              <Card key={p.title}>
                <Icon className="size-6 text-accent" aria-hidden />
                <h3 className="mt-3 font-semibold">{p.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-card py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-2xl font-semibold sm:text-3xl">{l.howTitle}</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {l.steps.map((step, i) => {
              const Icon = stepIcons[i];
              return (
                <li key={step.title}>
                  <Card className="h-full bg-background">
                    <div className="flex items-center gap-2 text-brand">
                      <span className="flex size-7 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
                        {i + 1}
                      </span>
                      <Icon className="size-5" aria-hidden />
                    </div>
                    <h3 className="mt-3 font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                  </Card>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Example basket */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">{l.exampleTitle}</h2>
            <p className="mt-3 text-muted-foreground">{l.exampleBody}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">{l.exampleDeposit}</p>
                <p className="mt-1 text-xl font-semibold">{pkr(split.deposit)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">{l.exampleBalance}</p>
                <p className="mt-1 text-xl font-semibold">{pkr(split.balance)}</p>
              </Card>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{l.exampleNote}</p>
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="p-3 text-start font-medium">{l.exampleItem}</th>
                  <th className="p-3 text-end font-medium">{l.exampleRetail}</th>
                  <th className="p-3 text-end font-medium">{l.exampleOurs}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {l.exampleItems.map((name, i) => (
                  <tr key={name}>
                    <td className="p-3">{name}</td>
                    <td className="p-3 text-end text-muted-foreground line-through">{pkr(EXAMPLE[i][0])}</td>
                    <td className="p-3 text-end font-medium">{pkr(EXAMPLE[i][1])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border">
                <tr>
                  <td className="p-3 font-semibold">{l.exampleTotal}</td>
                  <td className="p-3 text-end text-muted-foreground line-through">{pkr(totals.retail)}</td>
                  <td className="p-3 text-end text-base font-bold">{pkr(totals.total)}</td>
                </tr>
                <tr className="bg-brand-soft">
                  <td className="p-3 font-semibold text-brand" colSpan={2}>
                    {l.exampleSave}
                  </td>
                  <td className="p-3 text-end font-bold text-brand">
                    {pkr(totals.savings)} ({formatPct(totals.savingsPct)})
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </div>
      </section>

      {/* Trust */}
      <section className="bg-card py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-2xl font-semibold sm:text-3xl">{l.trustTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {l.trust.map((item, i) => {
              const Icon = trustIcons[i];
              return (
                <div key={item.title} className="flex gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft">
                    <Icon className="size-5 text-brand" aria-hidden />
                  </div>
                  <div>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Roles */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold sm:text-3xl">{l.rolesTitle}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
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

      {/* Suppliers + Ambassadors */}
      <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <PackageCheck className="size-7 text-brand" aria-hidden />
          <h2 className="text-xl font-semibold">{l.suppliersTitle}</h2>
          <p className="text-muted-foreground">{l.suppliersBody}</p>
          <ul className="space-y-2">
            {l.supplierPoints.map((pt) => (
              <li key={pt} className="flex gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                {pt}
              </li>
            ))}
          </ul>
          <Link href="/signup?as=supplier" className={buttonClass("secondary")}>
            {l.ctaSupplier}
          </Link>
        </Card>
        <Card className="space-y-4 border-brand/40 bg-brand-soft/40 p-6">
          <Building2 className="size-7 text-brand" aria-hidden />
          <h2 className="text-xl font-semibold">{l.ambassadorTitle}</h2>
          <p className="text-muted-foreground">{l.ambassadorBody}</p>
          <Link href="/signup" className={buttonClass("primary")}>
            {l.ambassadorCta}
          </Link>
        </Card>
      </section>

      {/* FAQ */}
      <section className="bg-card py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-2xl font-semibold sm:text-3xl">{l.faqTitle}</h2>
          <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-background">
            {l.faq.map((f) => (
              <details key={f.q} className="group p-4">
                <summary className="cursor-pointer list-none font-medium marker:hidden">
                  <span className="flex items-center justify-between gap-3">
                    {f.q}
                    <span className="text-brand transition-transform group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="rounded-2xl bg-brand px-6 py-12 text-center text-brand-foreground">
          <h2 className="text-2xl font-semibold sm:text-3xl">{l.finalTitle}</h2>
          <p className="mx-auto mt-3 max-w-2xl opacity-90">{l.finalBody}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className={buttonClass("secondary", "lg")}>
              {l.ctaResident}
            </Link>
            <Link href="/login" className={buttonClass("ghost", "lg", "text-brand-foreground hover:bg-white/10")}>
              {t.nav.login}
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <p>{l.footer}</p>
      </footer>
    </div>
  );
}
