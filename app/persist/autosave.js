// Autosave in the browser (SPEC 2): project JSON and drawing images in IndexedDB.
const DB = 'kj-energy-calculator';
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('project')) db.createObjectStore('project');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('library')) db.createObjectStore('library');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined);
    t.onerror = () => reject(t.error);
    if (r) r.onsuccess = () => {};
  });
}
function req(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

export async function saveProject(project) {
  const d = await db();
  await tx(d, 'project', 'readwrite', (s) => s.put(JSON.stringify(project), 'current'));
}
export async function loadProject() {
  const d = await db();
  const json = await req(d, 'project', 'readonly', (s) => s.get('current'));
  return json ? JSON.parse(json) : null;
}
export async function clearProject() {
  const d = await db();
  await tx(d, 'project', 'readwrite', (s) => s.delete('current'));
  await tx(d, 'blobs', 'readwrite', (s) => s.clear());
}
export async function putBlob(key, blob) {
  const d = await db();
  await tx(d, 'blobs', 'readwrite', (s) => s.put(blob, key));
}
export async function getBlob(key) {
  const d = await db();
  return req(d, 'blobs', 'readonly', (s) => s.get(key));
}
export async function deleteBlob(key) {
  const d = await db();
  await tx(d, 'blobs', 'readwrite', (s) => s.delete(key));
}
export async function listBlobKeys() {
  const d = await db();
  return req(d, 'blobs', 'readonly', (s) => s.getAllKeys());
}
// Shared material library additions (SPEC 3.8): stored outside the project, loaded by every project.
export async function saveLibraryExtras(extras) {
  const d = await db();
  await tx(d, 'library', 'readwrite', (s) => s.put(JSON.stringify(extras), 'materialsExtra'));
}
export async function loadLibraryExtras() {
  const d = await db();
  const json = await req(d, 'library', 'readonly', (s) => s.get('materialsExtra'));
  return json ? JSON.parse(json) : [];
}

// Debounced autosave driver.
export function attachAutosave(store, { delayMs = 1500, onSaved } = {}) {
  let timer = null;
  store.subscribe((state, meta) => {
    if (!store.isMain || meta.remote) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await saveProject(state.project);
        if (onSaved) onSaved();
      } catch (e) {
        console.error('autosave failed', e);
      }
    }, delayMs);
  });
}
