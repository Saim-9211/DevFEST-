import { redirect } from "next/navigation";
import { getAuthUser, getSessionContext, homePath } from "@/lib/auth";
import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/primitives";

/** Sends each user to the right home for their role. */
export default async function DashboardRedirect() {
  const ctx = await getSessionContext();
  if (ctx) redirect(homePath(ctx));

  const user = await getAuthUser();
  if (!user) redirect("/login");

  // Logged in with Supabase Auth, but there's no profile row to read the role from.
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <Card className="space-y-4">
        <h1 className="text-xl font-semibold">Your account isn&apos;t set up yet</h1>
        <p className="text-sm text-muted-foreground">
          You are signed in as <strong>{user.email ?? user.phone}</strong>, but no CollectiveCart profile was found for this account.
        </p>
        <Notice tone="error">
          This usually means the database migrations haven&apos;t been applied to the Supabase project. An admin needs to run the files in
          supabase/migrations (then supabase/seed.sql). Existing accounts get a profile automatically when the migrations run.
        </Notice>
        <form action={signOut}>
          <Button variant="secondary">Log out</Button>
        </form>
      </Card>
    </div>
  );
}
