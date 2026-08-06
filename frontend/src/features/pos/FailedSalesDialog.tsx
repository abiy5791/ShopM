import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/lib/auth";
import { type FailedSaleEntry, listFailed, removeFromFailed, requeueFailed } from "@/lib/offline";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";

import { syncOutbox } from "./api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  /** Called after a retry or discard so the POS badges refresh. */
  onChanged: () => Promise<void> | void;
}

/**
 * Review queue for offline sales the server rejected on sync (v2 plan §2).
 * A rung-up sale is never silently dropped: from here the user retries it
 * (e.g. after restocking) or explicitly discards it.
 */
export function FailedSalesDialog({ open, onOpenChange, currency, onChanged }: Props) {
  const qc = useQueryClient();
  const shopId = useAuthStore((s) => s.activeShopId);
  const [entries, setEntries] = useState<FailedSaleEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // client_uuid being acted on
  const [confirming, setConfirming] = useState<string | null>(null); // pending discard

  const load = useCallback(async () => {
    if (shopId) setEntries(await listFailed(shopId));
  }, [shopId]);

  useEffect(() => {
    if (open) {
      load();
      setConfirming(null);
    }
  }, [open, load]);

  async function retry(entry: FailedSaleEntry) {
    if (!shopId) return;
    setBusy(entry.client_uuid);
    try {
      await requeueFailed(entry.client_uuid);
      const synced = await syncOutbox(shopId);
      await load();
      await onChanged();
      if (synced > 0) {
        // The sale landed on the server — refresh what it changed.
        for (const key of [["sales"], ["products"], ["customers"], ["dashboard"]]) {
          qc.invalidateQueries({ queryKey: key });
        }
        toast.success("Sale synced.");
      } else {
        toast.error("The sale was rejected again — see the reason below.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function discard(entry: FailedSaleEntry) {
    setBusy(entry.client_uuid);
    try {
      await removeFromFailed(entry.client_uuid);
      await load();
      await onChanged();
      toast.success("Sale discarded.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Failed sales</DialogTitle>
          <DialogDescription>
            These sales were rung up offline but rejected when syncing. Retry after fixing the cause
            (for example, restocking), or discard if the sale should not be recorded.
          </DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No failed sales.</p>
        ) : (
          <ul className="max-h-80 space-y-3 overflow-y-auto">
            {entries.map((entry) => {
              const itemCount = entry.payload.items.reduce((n, i) => n + i.quantity, 0);
              return (
                <li key={entry.client_uuid} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {formatMoney(entry.receipt.total, currency)}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {itemCount} {itemCount === 1 ? "item" : "items"} ·{" "}
                          {formatDateTime(entry.created_at)}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-destructive">{entry.error}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={busy === entry.client_uuid}
                        onClick={() => retry(entry)}
                      >
                        <RefreshCw className="h-3 w-3" /> Retry
                      </Button>
                      {confirming === entry.client_uuid ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={busy === entry.client_uuid}
                          onClick={() => discard(entry)}
                        >
                          Confirm discard
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                          disabled={busy === entry.client_uuid}
                          onClick={() => setConfirming(entry.client_uuid)}
                        >
                          <Trash2 className="h-3 w-3" /> Discard
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
