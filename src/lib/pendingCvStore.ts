/**
 * Server-side in-memory store for CV uploads that have been previewed but not
 * yet confirmed. Avoids bouncing the PDF binary (as base64) back through the
 * browser and the WAF on the confirm step.
 *
 * Entries expire after 30 minutes. The store is bounded to 200 entries max to
 * prevent unbounded memory growth.
 */

import { randomUUID } from "node:crypto";

export type PendingCvEntry = {
  rawCV: string;
  cvFileName: string;
  cvMimeType: string;
  cvFileData: Buffer;
  expiresAt: number;
};

const MAX_ENTRIES = 200;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const store = new Map<string, PendingCvEntry>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export function storePendingCv(
  entry: Omit<PendingCvEntry, "expiresAt">,
): string {
  evictExpired();

  // If still over the cap, remove the oldest entry.
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }

  const token = randomUUID();
  store.set(token, { ...entry, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function consumePendingCv(token: string): PendingCvEntry | null {
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token); // one-time use
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}
