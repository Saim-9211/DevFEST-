import Link from "next/link";
import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n";
import { isSupabaseConfigured } from "@/lib/env";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input, Notice } from "@/components/ui/primitives";
import { signInWithPassword } from "../actions";
import { PhoneOtpForm } from "../phone-otp-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { t } = await getDictionary();
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold">{t.auth.loginTitle}</h1>
        {!isSupabaseConfigured ? <Notice tone="error">{t.auth.notConfigured}</Notice> : null}

        <ActionForm action={signInWithPassword}>
          <input type="hidden" name="next" value={next} />
          <Field label={t.auth.email}>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label={t.auth.password}>
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton className="w-full">{t.auth.loginButton}</SubmitButton>
        </ActionForm>

        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t.auth.orPhone}</summary>
          <div className="mt-3">
            <PhoneOtpForm
              next={next}
              labels={{
                phone: t.auth.phone,
                phoneHint: t.auth.phoneHint,
                sendCode: t.auth.sendCode,
                code: t.auth.code,
                verifyCode: t.auth.verifyCode,
              }}
            />
          </div>
        </details>

        <p className="text-sm text-muted-foreground">
          {t.auth.noAccount}{" "}
          <Link href="/signup" className="font-medium text-brand underline">
            {t.nav.signup}
          </Link>
        </p>
      </Card>
    </div>
  );
}
