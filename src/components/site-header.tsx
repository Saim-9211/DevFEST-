import Link from "next/link";
import { ShoppingBasket } from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import { getSessionContext, homePath } from "@/lib/auth";
import { signOut, toggleLocale } from "@/app/actions";
import { buttonClass } from "@/components/ui/button";

export async function SiteHeader() {
  const [{ t }, ctx] = await Promise.all([getDictionary(), getSessionContext()]);

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-brand">
          <ShoppingBasket className="size-5" aria-hidden />
          {t.appName}
        </Link>
        <nav className="flex items-center gap-1">
          <form action={toggleLocale}>
            <button className={buttonClass("ghost", "sm")} aria-label="Switch language">
              {t.nav.language}
            </button>
          </form>
          {ctx ? (
            <>
              <Link href={homePath(ctx)} className={buttonClass("secondary", "sm")}>
                {t.nav.dashboard}
              </Link>
              <form action={signOut}>
                <button className={buttonClass("ghost", "sm")}>{t.nav.logout}</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost", "sm")}>
                {t.nav.login}
              </Link>
              <Link href="/signup" className={buttonClass("primary", "sm")}>
                {t.nav.signup}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
