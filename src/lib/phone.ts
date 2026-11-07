/** Pakistani mobile numbers: 03XXXXXXXXX, 923XXXXXXXXX or +923XXXXXXXXX -> E.164 (+923XXXXXXXXX). */
export function normalizePkPhone(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
  if (/^\+923\d{9}$/.test(digits)) return digits;
  if (/^923\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}
