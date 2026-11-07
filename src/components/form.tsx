"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Notice } from "@/components/ui/primitives";

/** Result returned by every server action that backs a form. */
export type FormState = { error?: string; success?: string } | undefined;
export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

export function SubmitButton({
  children,
  variant,
  className,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant} className={className} aria-busy={pending}>
      {pending ? "…" : children}
    </Button>
  );
}

/** A <form> wired to a server action, showing its error/success message. */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
      {children}
    </form>
  );
}
