// Encrypted cloud backup. The AES key is derived once from the user's recovery key and kept on this device as a
// non-extractable CryptoKey, so scheduled backups run without asking for anything. The recovery key itself is
// never stored: restoring on another phone needs the recovery key the user saved.
import { getKV, setKV } from './db.js';
import {
  deriveKey, encryptText, decryptWithKey, keyForEnvelope, randomBytes, newKeyId, fromB64, KDF_ITERATIONS,
} from '../core/crypto.js';
import { buildBackup } from '../core/backup.js';
import * as gdrive from './gdrive.js';

const KEY = 'backupKey';

/** Derive and keep the backup key from a (new) recovery key. */
export async function setupBackupKey(recoveryKey) {
  const salt = randomBytes(16);
  const key = await deriveKey(recoveryKey, salt, KDF_ITERATIONS);
  await setKV(KEY, { salt, iterations: KDF_ITERATIONS, key, keyId: newKeyId(), createdAt: Date.now() });
}

/** Keep using the recovery key a restored backup was made with (its salt, so the derived key is identical). */
export async function adoptBackupKey(key, envelope) {
  await setKV(KEY, {
    salt: fromB64(envelope.kdf.salt), iterations: Number(envelope.kdf.iterations), key,
    keyId: envelope.keyId || newKeyId(), createdAt: Date.now(),
  });
}

async function localKey() {
  const k = await getKV(KEY).catch(() => null);
  return k?.key ? k : null;
}

export async function hasBackupKey() {
  return !!(await localKey());
}

/** Encrypt a full snapshot of the app data. Returns the envelope as JSON text. */
export async function encryptSnapshot(snapshot) {
  const k = await localKey();
  if (!k) throw Object.assign(new Error('还没有设定备份加密'), { code: 'no-key' });
  const envelope = await encryptText(k.key, JSON.stringify(buildBackup(snapshot)), { salt: k.salt, iterations: k.iterations, keyId: k.keyId });
  return JSON.stringify(envelope);
}

/** Upload an encrypted backup to Google Drive and keep the newest ones. Needs a live token. */
export async function backupToDrive(snapshot) {
  const text = await encryptSnapshot(snapshot);
  const file = await gdrive.uploadBackup(text);
  await gdrive.pruneBackups().catch(() => {});
  return file;
}

/** Try the key kept on this device (a backup made from this phone opens without typing anything). */
export async function decryptWithLocalKey(envelope) {
  const k = await localKey();
  if (!k || (envelope.keyId && k.keyId && envelope.keyId !== k.keyId)) return null;
  try { return await decryptWithKey(k.key, envelope); } catch { return null; }
}

/** Decrypt with a typed recovery key. Returns { text, key } or throws { code: 'bad-secret' | 'bad-format' }. */
export async function decryptWithRecoveryKey(recoveryKey, envelope) {
  const key = await keyForEnvelope(recoveryKey, envelope);
  return { text: await decryptWithKey(key, envelope), key };
}
