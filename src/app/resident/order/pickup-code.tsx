"use client";

import { useActionState, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Notice } from "@/components/ui/primitives";
import { SubmitButton, type FormState } from "@/components/form";
import { generatePickupCode } from "../actions";

/** Generates a fresh pickup code on request and shows it with a QR for the pickup desk. */
export function PickupCode({ basketId, labels }: { basketId: string; labels: { show: string; hint: string } }) {
  const [state, action] = useActionState<FormState, FormData>(generatePickupCode, undefined);
  const [qr, setQr] = useState<string | null>(null);
  const code = state?.success;

  useEffect(() => {
    if (code) QRCode.toDataURL(`CC:${basketId}:${code}`, { margin: 1, width: 192 }).then(setQr);
  }, [code, basketId]);

  return (
    <div className="space-y-3">
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {code ? (
        <div className="flex flex-wrap items-center gap-5 rounded-lg bg-muted p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated in the browser */}
          {qr ? <img src={qr} alt="Pickup QR code" width={160} height={160} className="rounded bg-white p-1" /> : null}
          <div>
            <p className="font-mono text-4xl font-bold tracking-[0.3em]">{code}</p>
            <p className="mt-1 text-sm text-muted-foreground">{labels.hint}</p>
          </div>
        </div>
      ) : null}
      <form action={action}>
        <SubmitButton variant={code ? "secondary" : "primary"}>{labels.show}</SubmitButton>
      </form>
    </div>
  );
}
