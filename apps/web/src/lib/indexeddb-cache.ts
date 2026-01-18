/**
 * IndexedDB Cache (Browser Only)
 *
 * Stores large repository artifacts (full knowledge base + code intelligence)
 * without localStorage quota limits.
 */

const DB_NAME = 'docgen-cache';
const DB_VERSION = 1;
const STORE_NAME = 'repo-cache';

type CacheKeyType = 'knowledge-base' | 'code-intelligence';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function buildCacheKey(
  repoUrl: string,
  commitHash: string | null | undefined,
  type: CacheKeyType,
  options?: { embeddings?: boolean }
): string {
  const normalizedRepo = repoUrl.replace(/\/+$/, '').toLowerCase();
  const commit = commitHash || 'unknown';
  const emb = options?.embeddings ? 'embeddings' : 'no-embeddings';
  return `${normalizedRepo}::${commit}::${type}::${emb}`;
}

async function openDb(): Promise<IDBDatabase | null> {
  if (!isBrowser()) return null;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGet<T>(
  repoUrl: string,
  commitHash: string | null | undefined,
  type: CacheKeyType,
  options?: { embeddings?: boolean }
): Promise<T | null> {
  const key = buildCacheKey(repoUrl, commitHash, type, options);
  return withStore('readonly', (store) => store.get(key));
}

export async function idbSet<T>(
  repoUrl: string,
  commitHash: string | null | undefined,
  type: CacheKeyType,
  value: T,
  options?: { embeddings?: boolean }
): Promise<void> {
  const key = buildCacheKey(repoUrl, commitHash, type, options);
  await withStore('readwrite', (store) => store.put(value as unknown as any, key as IDBValidKey));
}

export async function idbDelete(
  repoUrl: string,
  commitHash: string | null | undefined,
  type: CacheKeyType,
  options?: { embeddings?: boolean }
): Promise<void> {
  const key = buildCacheKey(repoUrl, commitHash, type, options);
  await withStore('readwrite', (store) => store.delete(key));
}

export function makeCacheKey(
  repoUrl: string,
  commitHash: string | null | undefined,
  type: CacheKeyType,
  options?: { embeddings?: boolean }
): string {
  return buildCacheKey(repoUrl, commitHash, type, options);
}

