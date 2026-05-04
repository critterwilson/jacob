/**
 * IndexedDB cleanup on sign-out.
 *
 * The "jacob-cache" database used to hold per-group message caches
 * (T36 / pre-M3). M3 moved chat reads through `apiGet` and the cache
 * stopped being populated; the read-side path was removed when chat
 * polling became `since=`-incremental in PR3. The remaining
 * responsibility is to wipe the legacy database on sign-out so
 * historical cached data doesn't survive across users on a shared
 * device.
 */

const DB_NAME = "jacob-cache";

export async function clearCache(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
    req.onerror = () => resolve(); // best-effort; don't block sign-out
  });
}
