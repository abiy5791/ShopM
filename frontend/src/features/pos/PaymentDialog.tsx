import { Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import type { PaymentInput, PaymentMethod } from "@/types";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "mobile_money", label: "Mobile money" },
];

interface Line {
  method: PaymentMethod;
  amount: string; // major-unit string
}

export function PaymentDialog({
  open,
  onOpenChange,
  total,
  currency,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  currency: string;
  submitting: boolean;
  onConfirm: (payments: PaymentInput[]) => void;
}) {
  const [lines, setLines] = useState<Line[]>([
    { method: "cash", amount: minorToInput(total, currency) },
  ]);

  const paid = useMemo(
    () => lines.reduce((sum, l) => sum + (parseMoney(l.amount, currency) || 0), 0),
    [lines, currency],
  );
  const change = Math.max(0, paid - total);
  const remaining = Math.max(0, total - paid);
  const canConfirm = paid >= total && total >= 0;

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>
            Total due{" "}
            <span className="font-semibold text-foreground">{formatMoney(total, currency)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="w-36 space-y-1.5">
                <Label>Method</Label>
                <Select
                  value={line.method}
                  onValueChange={(v) => update(i, { method: v as PaymentMethod })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Amount ({currency})</Label>
                <Input
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                />
              </div>
              {lines.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLines((prev) => [...prev, { method: "cash", amount: "0" }])}
          >
            <Plus className="h-4 w-4" /> Split payment
          </Button>

          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid</span>
              <span className="font-mono tabular-nums">{formatMoney(paid, currency)}</span>
            </div>
            {remaining > 0 ? (
              <div className="flex justify-between text-destructive">
                <span>Remaining</span>
                <span className="font-mono tabular-nums">{formatMoney(remaining, currency)}</span>
              </div>
            ) : (
              <div className="flex justify-between text-accent">
                <span>Change</span>
                <span className="font-mono tabular-nums">{formatMoney(change, currency)}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canConfirm || submitting}
            onClick={() =>
              onConfirm(
                lines
                  .map((l) => ({ method: l.method, amount: parseMoney(l.amount, currency) || 0 }))
                  .filter((p) => p.amount > 0),
              )
            }
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Charge {formatMoney(total, currency)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
