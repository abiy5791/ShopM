import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import {
  cacheProducts,
  enqueueSale,
  getCachedProducts,
  listFailed,
  listOutbox,
  moveToFailed,
  type OutboxEntry,
  removeFromOutbox,
} from "@/lib/offline";
import type { Paginated, Product, ReceiptData, Sale, SalePayload, Shop } from "@/types";

/** A network error (no response) means we're offline — distinct from a 4xx/5xx. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof AxiosError && !err.response;
}

/** Shape of the server's error envelope (plan §9): {detail, code, fields}. */
export interface ApiErrorEnvelope {
  detail?: string;
  code?: string;
  fields?: Record<string, unknown>;
}

export function apiErrorEnvelope(err: unknown): ApiErrorEnvelope | null {
  if (err instanceof AxiosError && err.response?.data && typeof err.response.data === "object") {
    return err.response.data as ApiErrorEnvelope;
  }
  return null;
}

/** Per-product shortage info from an insufficient_stock rejection. */
export interface StockShortage {
  name: string;
  sku: string;
  requested: number;
  available: number;
}

export function stockShortages(err: unknown): Record<string, StockShortage> | null {
  const envelope = apiErrorEnvelope(err);
  if (envelope?.code !== "insufficient_stock" || !envelope.fields) return null;
  return envelope.fields as unknown as Record<string, StockShortage>;
}

/**
 * Active-shop product catalogue for the POS. Fetches from the server when online
 * and mirrors into IndexedDB; falls back to the cache when offline (plan §10.1).
 */
export function usePosCatalog() {
  const shopId = useAuthStore((s) => s.activeShopId);
  const [cached, setCached] = useState<Product[]>([]);

  useEffect(() => {
    if (shopId) getCachedProducts(shopId).then(setCached);
  }, [shopId]);

  const query = useQuery({
    queryKey: ["pos-products", shopId],
    enabled: Boolean(shopId),
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await api.get<Paginated<Product>>("/products", {
        params: { status: "active", page_size: 500, ordering: "name" },
      });
      const products = res.data.results;
      if (shopId) await cacheProducts(shopId, products);
      return products;
    },
  });

  const products = query.data ?? cached;
  return { products, offline: !query.data && cached.length > 0, isLoading: query.isLoading };
}

/** The active shop's record (name, currency, tax rate) — readable by any member. */
export function useActiveShop(): Shop | null {
  const shopId = useAuthStore((s) => s.activeShopId);
  const { data } = useQuery({
    queryKey: ["shops"],
    queryFn: async () => (await api.get<Paginated<Shop>>("/shops")).data.results,
    staleTime: 5 * 60 * 1000,
  });
  return data?.find((s) => s.id === shopId) ?? null;
}

function mapServerSaleToReceipt(sale: Sale, shopName: string, cashier: string): ReceiptData {
  return {
    shop_name: shopName,
    cashier_name: cashier,
    currency: "",
    created_at: sale.created_at,
    items: sale.items.map((i) => ({
      name: i.name_snapshot,
      quantity: i.quantity,
      unit_price: i.unit_price_snapshot,
      line_total: i.line_total,
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    amount_paid: sale.amount_paid,
    change: sale.change,
    offline: false,
  };
}

export interface CheckoutResult {
  receipt: ReceiptData;
  synced: boolean;
}

/**
 * Submit a sale. Online: POST and return the server receipt. Offline (or on a
 * network failure): enqueue to the outbox and return the locally-built receipt
 * so the cashier can still print (plan §10.3).
 */
export async function checkout(
  payload: SalePayload,
  localReceipt: ReceiptData,
  meta: { shopId: string; shopName: string; cashier: string },
): Promise<CheckoutResult> {
  const enqueueOffline = async (): Promise<CheckoutResult> => {
    await enqueueSale({
      client_uuid: payload.client_uuid,
      shopId: meta.shopId,
      payload,
      receipt: localReceipt,
      created_at: new Date().toISOString(),
    });
    return { receipt: localReceipt, synced: false };
  };

  if (!navigator.onLine) return enqueueOffline();

  try {
    const res = await api.post<Sale>("/sales", payload);
    const receipt = mapServerSaleToReceipt(res.data, meta.shopName, meta.cashier);
    return { receipt: { ...receipt, currency: localReceipt.currency }, synced: true };
  } catch (err) {
    if (isNetworkError(err)) return enqueueOffline();
    throw err; // a real 4xx/5xx (e.g. validation) — surface it
  }
}

/** Replay the outbox in order; the server's idempotency guarantees no dupes. */
export async function syncOutbox(shopId: string): Promise<number> {
  const pending = await listOutbox(shopId);
  let synced = 0;
  for (const entry of pending) {
    try {
      await api.post("/sales", entry.payload);
      await removeFromOutbox(entry.client_uuid);
      synced += 1;
    } catch (err) {
      if (isNetworkError(err)) break; // still offline — stop, retry later
      // The server rejected the sale (e.g. stock ran out while offline). Keep
      // it in the failed store for review — never silently drop a rung-up sale.
      const envelope = apiErrorEnvelope(err);
      await moveToFailed(entry, envelope?.detail ?? "The server rejected this sale.");
    }
  }
  return synced;
}

/** Tracks the pending-sync and failed counts; drains the outbox when back online. */
export function usePendingSync() {
  const shopId = useAuthStore((s) => s.activeShopId);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);

  const refresh = useCallback(async () => {
    if (!shopId) return;
    const entries: OutboxEntry[] = await listOutbox(shopId);
    setPending(entries.length);
    setFailed((await listFailed(shopId)).length);
  }, [shopId]);

  const drain = useCallback(async () => {
    if (!shopId || !navigator.onLine) return;
    await syncOutbox(shopId);
    await refresh();
  }, [shopId, refresh]);

  useEffect(() => {
    refresh();
    const onOnline = () => {
      setOnline(true);
      drain();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const id = window.setInterval(drain, 20_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(id);
    };
  }, [drain, refresh]);

  return { pending, failed, online, drain, refresh };
}
