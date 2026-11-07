import Link from "next/link";
import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n";
import { isSupabaseConfigured } from "@/lib/env";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input, Notice } from "@/components/ui/primitives";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { t } = await getDictionary();
  const sp = await searchParams;
  const asSupplier = sp.as === "supplier";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">{t.auth.signupTitle}</h1>
          {asSupplier ? <p className="mt-1 text-sm text-muted-foreground">{t.onboarding.supplierBody}</p> : null}
        </div>
        {!isSupabaseConfigured ? <Notice tone="error">{t.auth.notConfigured}</Notice> : null}

        <ActionForm action={signUp}>
          {asSupplier ? <input type="hidden" name="as" value="supplier" /> : null}
          <Field label={t.auth.fullName}>
            <Input name="full_name" autoComplete="name" required minLength={2} maxLength={80} />
          </Field>
          <Field label={t.auth.email}>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label={t.auth.phone} hint={t.auth.phoneHint}>
            <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="03001234567" />
          </Field>
          <Field label={t.auth.password}>
            <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
          </Field>
          <SubmitButton className="w-full">{t.auth.signupButton}</SubmitButton>
        </ActionForm>

        <p className="text-sm text-muted-foreground">
          {t.auth.haveAccount}{" "}
          <Link href="/login" className="font-medium text-brand underline">
            {t.nav.login}
          </Link>
        </p>
      </Card>
    </div>
  );
}
