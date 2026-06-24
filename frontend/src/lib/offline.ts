/**
 * Offline storage for the POS (plan §3.4, §10). IndexedDB holds:
 *  - a cache of the active shop's products (so search works with no network), and
 *  - an outbox of completed-but-unsynced sales (replayed when back online).
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
}

let dbPromise: Promise<IDBPDatabase<ShopMDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ShopMDB>("shopm-pos", 1, {
      upgrade(db) {
        const products = db.createObjectStore("products", { keyPath: "id" });
        products.createIndex("by-shop", "shopId");
        const outbox = db.createObjectStore("outbox", { keyPath: "client_uuid" });
        outbox.createIndex("by-shop", "shopId");
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

export async function countOutbox(shopId: string): Promise<number> {
  return (await listOutbox(shopId)).length;
}
