import { Button } from "@/components/ui/button";
import type { CycleStatus } from "@/lib/data";
import { runCycleStep, type CycleStep } from "./actions";

const NEXT: Record<CycleStatus, { step: CycleStep; label: string; hint?: string }[]> = {
  draft: [
    { step: "open", label: "Open for orders" },
    { step: "cancel", label: "Cancel" },
  ],
  open: [
    { step: "cutoff", label: "Run cutoff now", hint: "Checks each building's minimum, refunds the ones below it, builds lots and picks suppliers" },
    { step: "cancel", label: "Cancel & refund all" },
  ],
  locked: [
    { step: "issue_pos", label: "Issue purchase orders" },
    { step: "cancel", label: "Cancel & refund all" },
  ],
  ordered: [{ step: "dispatched", label: "Mark dispatched (override)" }],
  dispatched: [{ step: "delivered", label: "Mark delivered (override)" }],
  delivered: [{ step: "distribute", label: "Open pickup" }],
  distributing: [{ step: "close", label: "Close cycle (no-shows forfeit deposit)" }],
  closed: [],
  cancelled: [],
};

/** Buttons for the legal next steps of a cycle. */
export function CycleActions({ cycleId, status }: { cycleId: string; status: CycleStatus }) {
  return (
    <div className="flex flex-wrap gap-2">
      {NEXT[status].map((n) => (
        <form key={n.step} action={runCycleStep.bind(null, cycleId, n.step)}>
          <Button size="sm" variant={n.step === "cancel" ? "ghost" : "primary"} title={n.hint}>
            {n.label}
          </Button>
        </form>
      ))}
    </div>
  );
}
