import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Nastaliq_Urdu } from "next/font/google";
import { getDictionary } from "@/lib/i18n";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const nastaliq = Noto_Nastaliq_Urdu({ variable: "--font-nastaliq", subsets: ["arabic"], weight: ["400", "700"] });

export const metadata: Metadata = {
  title: { default: "BulkBasket: buy groceries together", template: "%s · BulkBasket" },
  description:
    "Community grocery group-buying for apartment buildings in Pakistan. Pool monthly orders, let wholesalers bid, save on staples.",
};

// The <html lang/dir> depends on the language cookie and every area depends on the session,
// so pages render per request. This opts the app out of Cache Components' static-shell check;
// static marketing sections can adopt `use cache` + <Suspense> later, route by route.
export const instant = false;

export const viewport: Viewport = { themeColor: "#15803d", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, dir } = await getDictionary();
  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} ${nastaliq.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
