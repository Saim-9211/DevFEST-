import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPKR(amount: number | null | undefined, locale: "en" | "ur" = "en") {
  if (amount == null || Number.isNaN(amount)) return "—";
  const n = new Intl.NumberFormat(locale === "ur" ? "ur-PK" : "en-PK", {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
  return locale === "ur" ? `${n} روپے` : `Rs ${n}`;
}

export function formatPct(fraction: number) {
  return `${Math.round(fraction * 100)}%`;
}

/** True if `iso` is within the last `hours` hours (UI hint only; the database enforces windows). */
export function isWithinHours(iso: string | null | undefined, hours: number): boolean {
  return Boolean(iso) && Date.now() - new Date(iso as string).getTime() < hours * 3600_000;
}

/** Narrow an unknown error (e.g. a Postgres exception surfaced by Supabase) to a message. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong. Please try again.";
}
