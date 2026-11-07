import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

/** Simple tab-style navigation for an area. */
export function AreaNav({ links }: { links: { href: string; label: string }[] }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-border pb-3" aria-label="Section">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={buttonClass("ghost", "sm")}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
