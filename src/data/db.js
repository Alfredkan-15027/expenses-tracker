// Minimal IndexedDB wrapper. Everything stays on this device.

const DB_NAME = 'expenses-tracker';
const DB_VERSION = 1;
export const STORES = ['transactions', 'categories', 'recurring', 'kv'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('recurring')) db.createObjectStore('recurring', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('数据库被另一个分页占用，请关闭其他分页后重试。'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function getAll(store) {
  const db = await open();
  return request(db.transaction(store).objectStore(store).getAll());
}

export async function getKV(key) {
  const db = await open();
  return request(db.transaction('kv').objectStore('kv').get(key));
}

export async function setKV(key, value) {
  const db = await open();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  return done(tx);
}

export async function deleteKV(key) {
  const db = await open();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').delete(key);
  return done(tx);
}

/** Put many records into one store in a single transaction. */
export async function putMany(store, items) {
  if (!items.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const item of items) s.put(item);
  return done(tx);
}

export async function deleteMany(store, ids) {
  if (!ids.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const id of ids) s.delete(id);
  return done(tx);
}

/** Replace the whole database content atomically (used by restore). */
export async function replaceAll({ transactions, categories, recurring, settings }) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  const put = (name, items) => {
    const s = tx.objectStore(name);
    s.clear();
    for (const item of items) s.put(item);
  };
  put('transactions', transactions);
  put('categories', categories);
  put('recurring', recurring);
  tx.objectStore('kv').put(settings, 'settings');
  return done(tx);
}

/** Wipe every record (keeps the empty database). */
export async function clearAll() {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) tx.objectStore(name).clear();
  return done(tx);
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* not supported */ }
  return false;
}
