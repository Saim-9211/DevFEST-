/**
 * Runs SQL against the hosted Supabase database through the Management API.
 *
 *   npm run db:apply -- supabase/migrations/20261107000100_schema.sql supabase/seed.sql
 *   npm run db:apply -- --sql "select count(*) from public.products"
 *
 * Needs SUPABASE_ACCESS_TOKEN (a personal access token, sbp_...) and NEXT_PUBLIC_SUPABASE_URL in .env.
 * Files run in the order given; the script stops at the first error.
 */
import { readFileSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!token || !ref) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or NEXT_PUBLIC_SUPABASE_URL (see .env.example).");
  process.exit(1);
}

async function run(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const args = process.argv.slice(2);
if (args[0] === "--sql") {
  console.log(JSON.stringify(await run(args.slice(1).join(" ")), null, 2));
} else {
  for (const file of args) {
    process.stdout.write(`→ ${file} ... `);
    try {
      await run(readFileSync(file, "utf8"));
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.error(e.message);
      process.exit(1);
    }
  }
}
