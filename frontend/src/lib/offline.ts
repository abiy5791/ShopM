/**
 * Offline storage for the POS (plan §3.4, §10). IndexedDB holds:
 *  - a cache of the active shop's products (so search works with no network),
 *  - an outbox of completed-but-unsynced sales (replayed when back online), and
 *  - a failed store for sales the server rejected on replay (v2 plan §2) —
 *    they are kept for review and never silently dropped.
 *
 * Each sale carries a client-generated UUID; the server is idempotent on it, so
 * replaying the outbox can never double-record a sale.
 */
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

import type { Product, ReceiptData, SalePayload } from "@/types";

export interface OutboxEntry {
  client_uuid: string;
  shopId: string;
  payload: SalePayload;
  receipt: ReceiptData;
  created_at: string;
}

export interface FailedSaleEntry extends OutboxEntry {
  error: string; // human-readable server rejection reason
  failed_at: string;
}

interface ProductCacheEntry extends Product {
  shopId: string;
}

interface ShopMDB extends DBSchema {
  products: {
    key: string;
    value: ProductCacheEntry;
    indexes: { "by-shop": string };
  };
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { "by-shop": string };
  };
  failed: {
    key: string;
    value: FailedSaleEntry;
    indexes: { "by-shop": string };
  };
}

let dbPromise: Promise<IDBPDatabase<ShopMDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ShopMDB>("shopm-pos", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const products = db.createObjectStore("products", { keyPath: "id" });
          products.createIndex("by-shop", "shopId");
          const outbox = db.createObjectStore("outbox", { keyPath: "client_uuid" });
          outbox.createIndex("by-shop", "shopId");
        }
        if (oldVersion < 2) {
          const failed = db.createObjectStore("failed", { keyPath: "client_uuid" });
          failed.createIndex("by-shop", "shopId");
        }
      },
    });
  }
  return dbPromise;
}

// ---- product cache ----
export async function cacheProducts(shopId: string, products: Product[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("products", "readwrite");
  const index = tx.store.index("by-shop");
  // Replace this shop's cached products.
  let cursor = await index.openCursor(shopId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  for (const p of products) {
    await tx.store.put({ ...p, shopId });
  }
  await tx.done;
}

export async function getCachedProducts(shopId: string): Promise<Product[]> {
  const db = await getDB();
  return db.getAllFromIndex("products", "by-shop", shopId);
}

// ---- outbox ----
export async function enqueueSale(entry: OutboxEntry): Promise<void> {
  const db = await getDB();
  await db.put("outbox", entry);
}

export async function listOutbox(shopId: string): Promise<OutboxEntry[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("outbox", "by-shop", shopId);
  return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function removeFromOutbox(clientUuid: string): Promise<void> {
  const db = await getDB();
  await db.delete("outbox", clientUuid);
}

// ---- failed sales (server-rejected on replay; kept until reviewed) ----
export async function moveToFailed(entry: OutboxEntry, error: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["outbox", "failed"], "readwrite");
  await tx.objectStore("failed").put({ ...entry, error, failed_at: new Date().toISOString() });
  await tx.objectStore("outbox").delete(entry.client_uuid);
  await tx.done;
}

export async function listFailed(shopId: string): Promise<FailedSaleEntry[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("failed", "by-shop", shopId);
  return all.sort((a, b) => b.failed_at.localeCompare(a.failed_at));
}

/** Move a failed sale back to the outbox for another sync attempt. */
export async function requeueFailed(clientUuid: string): Promise<void> {
  const db = await getDB();
  const entry = await db.get("failed", clientUuid);
  if (!entry) return;
  const tx = db.transaction(["outbox", "failed"], "readwrite");
  const outboxEntry: OutboxEntry = {
    client_uuid: entry.client_uuid,
    shopId: entry.shopId,
    payload: entry.payload,
    receipt: entry.receipt,
    created_at: entry.created_at,
  };
  await tx.objectStore("outbox").put(outboxEntry);
  await tx.objectStore("failed").delete(clientUuid);
  await tx.done;
}

/** Permanently discard a failed sale (an explicit, user-confirmed action). */
export async function removeFromFailed(clientUuid: string): Promise<void> {
  const db = await getDB();
  await db.delete("failed", clientUuid);
}
