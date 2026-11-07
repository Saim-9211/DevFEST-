"use client";

import { useActionState, useState } from "react";
import { Field, Input, Notice } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/form";
import { sendPhoneOtp, verifyPhoneOtp } from "./actions";

type Labels = { phone: string; phoneHint: string; sendCode: string; code: string; verifyCode: string };

/** Two-step SMS login. Requires an SMS provider (e.g. Twilio) configured in Supabase Auth. */
export function PhoneOtpForm({ labels, next }: { labels: Labels; next: string }) {
  const [phone, setPhone] = useState("");
  const [sendState, sendAction] = useActionState(sendPhoneOtp, undefined);
  const [verifyState, verifyAction] = useActionState(verifyPhoneOtp, undefined);
  const codeSent = Boolean(sendState?.success);

  return (
    <div className="space-y-3">
      <form action={sendAction} className="space-y-3">
        {sendState?.error ? <Notice tone="error">{sendState.error}</Notice> : null}
        {sendState?.success ? <Notice tone="success">{sendState.success}</Notice> : null}
        <Field label={labels.phone} hint={labels.phoneHint}>
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="03001234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </Field>
        <SubmitButton variant="secondary" className="w-full">
          {labels.sendCode}
        </SubmitButton>
      </form>

      {codeSent ? (
        <form action={verifyAction} className="space-y-3">
          {verifyState?.error ? <Notice tone="error">{verifyState.error}</Notice> : null}
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="next" value={next} />
          <Field label={labels.code}>
            <Input name="token" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
          </Field>
          <SubmitButton className="w-full">{labels.verifyCode}</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
