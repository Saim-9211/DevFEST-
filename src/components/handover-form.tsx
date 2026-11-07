"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/form";
import { Input } from "@/components/ui/primitives";

/** OTP entry for the pickup desk (ambassador or agent). */
export function HandoverForm({ action, label, button }: { action: FormAction; label: string; button: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-start gap-2">
      <Input
        name="code"
        inputMode="numeric"
        autoComplete="off"
        pattern="\d{6}"
        maxLength={6}
        placeholder="______"
        aria-label={label}
        className="w-28 font-mono tracking-widest"
        required
      />
      <SubmitButton>{button}</SubmitButton>
    </ActionForm>
  );
}
