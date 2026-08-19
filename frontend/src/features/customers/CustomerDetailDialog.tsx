import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEthiopian } from "@/lib/ethiopian";
import { formatMoney, parseMoney } from "@/lib/money";
import type { Customer } from "@/types";

import { useCustomerLedger, useSettlePayment } from "./api";

export function CustomerDetailDialog({
  customer,
  currency,
  onOpenChange,
}: {
  customer: Customer | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useCustomerLedger(customer?.id ?? null);
  const settle = useSettlePayment();
  const [amount, setAmount] = useState("");

  const balance = data?.balance ?? customer?.credit_balance_cached ?? 0;

  async function handleSettle() {
    if (!customer) return;
    const minor = parseMoney(amount || "0", currency);
    if (!Number.isFinite(minor) || minor <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    try {
      await settle.mutateAsync({ customer: customer.id, method: "cash", amount: minor });
      toast.success("Payment recorded");
      setAmount("");
    } catch {
      toast.error("Could not record payment.");
    }
  }

  return (
    <Dialog open={Boolean(customer)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer?.name}</DialogTitle>
          <DialogDescription>{customer?.phone || "No phone on file"}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md bg-muted/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">Outstanding balance</span>
          <span
            className={
              "font-mono text-lg font-semibold tabular-nums " +
              (balance > 0 ? "text-destructive" : "text-accent")
            }
          >
            {formatMoney(balance, currency)}
          </span>
        </div>

        {balance > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-medium">Settle ({currency})</label>
              <Input
                inputMode="decimal"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <Button onClick={handleSettle} disabled={settle.isPending}>
              {settle.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Record payment
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Section title="Sales">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : data && data.sales.length > 0 ? (
              data.sales.map((s) => (
                <Row
                  key={s.id}
                  left={formatEthiopian(s.occurred_at)}
                  right={formatMoney(s.total, currency)}
                  badge={s.status === "voided" ? "voided" : undefined}
                />
              ))
            ) : (
              <Empty />
            )}
          </Section>
          <Section title="Payments">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : data && data.payments.length > 0 ? (
              data.payments.map((p) => (
                <Row
                  key={p.id}
                  left={formatEthiopian(p.received_at)}
                  right={formatMoney(p.amount, currency)}
                  badge={p.sale ? "sale" : "settlement"}
                />
              ))
            ) : (
              <Empty />
            )}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ left, right, badge }: { left: string; right: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
      <span className="flex items-center gap-2 text-muted-foreground">
        {left}
        {badge && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {badge}
          </Badge>
        )}
      </span>
      <span className="font-mono tabular-nums">{right}</span>
    </div>
  );
}

function Empty() {
  return <p className="py-3 text-sm text-muted-foreground">Nothing yet.</p>;
}
