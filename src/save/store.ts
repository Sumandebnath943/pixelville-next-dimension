/* ============================================================
   Save slots in IndexedDB (a 256² village outgrows localStorage):
   three named slots plus a rolling autosave, as in V1.
   ============================================================ */

const DB = 'pixelville-nd';
const STORE = 'saves';
export const SLOTS = ['slot1', 'slot2', 'slot3'];
export const AUTO = 'auto';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return dbp;
}

export async function put(key: string, data: string): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function get(key: string): Promise<string | null> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve((r.result as string) ?? null);
    r.onerror = () => reject(r.error);
  });
}

export interface SlotMeta { name: string; day: number; pop: number | string; at: number }
export function metaOf(data: string | null): SlotMeta | null {
  if (!data) return null;
  try {
    const o = JSON.parse(data);
    return (o.extra && o.extra.meta) || { name: o.name || 'PixelVille', day: (o.extra || {}).day || 1, pop: '?', at: 0 };
  } catch {
    return null;
  }
}
