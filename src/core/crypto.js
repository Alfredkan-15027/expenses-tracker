// Encryption for cloud backups: AES-256-GCM with a key derived (PBKDF2-SHA-256) from a random recovery key
// that only the user holds — 28 characters, 140 bits, far beyond guessing even with the encrypted file in hand.
// (A 6-digit passcode would not be: a million guesses take minutes on one GPU.)
// Works in browsers and in Node 20+ (globalThis.crypto.subtle). The recovery key itself is never stored.

export const ENVELOPE_FORMAT = 'expenses-tracker-encrypted';
export const KDF_ITERATIONS = 600_000;

// No 0/O or 1/I, so a key read off paper cannot be misread. 32 symbols = 5 bits each.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 28;

const groupKey = (s) => s.match(/.{4}/g).join('-');

/** A new random recovery key, e.g. "K7QM-2XNP-…" (7 groups of 4). */
export function newRecoveryKey() {
  const bytes = randomBytes(RECOVERY_LENGTH);
  return groupKey([...bytes].map((b) => RECOVERY_ALPHABET[b & 31]).join(''));
}

/** Canonical form of a typed / pasted recovery key, or null when it is not a valid key. */
export function normalizeRecoveryKey(input) {
  const s = String(input || '').toUpperCase().replace(/[\s\-–—_.]/g, '');
  if (s.length !== RECOVERY_LENGTH || [...s].some((c) => !RECOVERY_ALPHABET.includes(c))) return null;
  return groupKey(s);
}

/** Short random id stored with the key and in every envelope, so the app knows which key a backup needs. */
export function newKeyId() {
  return [...randomBytes(8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/** Derive a non-extractable AES-GCM key from a passcode. */
export async function deriveKey(passcode, salt, iterations = KDF_ITERATIONS) {
  const base = await subtle().importKey('raw', enc.encode(String(passcode)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt text with an existing key. kdf = { salt (Uint8Array), iterations, keyId } recorded in the envelope
 * (salt and iterations are public by design; they are needed to derive the key again from the recovery key).
 */
export async function encryptText(key, text, kdf) {
  const iv = randomBytes(12);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return {
    format: ENVELOPE_FORMAT,
    v: 2,
    secret: 'recovery-key',
    keyId: kdf.keyId || null,
    createdAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: toB64(kdf.salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(new Uint8Array(data)),
  };
}

export function isEnvelope(obj) {
  return !!obj && obj.format === ENVELOPE_FORMAT && (obj.v === 1 || obj.v === 2)
    && !!obj.kdf && !!obj.cipher && typeof obj.data === 'string';
}

function checkParams(envelope) {
  if (!isEnvelope(envelope)) throw Object.assign(new Error('不是加密备份文件'), { code: 'bad-format' });
  const iterations = Number(envelope.kdf.iterations);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 5_000_000) {
    throw Object.assign(new Error('备份文件的加密参数无效'), { code: 'bad-format' });
  }
  return iterations;
}

/** Decrypt with a ready key (e.g. the one kept on this device). Throws { code: 'bad-secret' } when it does not fit. */
export async function decryptWithKey(key, envelope) {
  checkParams(envelope);
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(envelope.cipher.iv) }, key, fromB64(envelope.data));
    return dec.decode(plain);
  } catch {
    throw Object.assign(new Error('密钥不正确'), { code: 'bad-secret' });
  }
}

/** Derive the key for this envelope from the secret (recovery key). */
export async function keyForEnvelope(secret, envelope) {
  const iterations = checkParams(envelope);
  return deriveKey(secret, fromB64(envelope.kdf.salt), iterations);
}

/** Decrypt an envelope with its secret (recovery key). Throws { code: 'bad-secret' } on a wrong secret. */
export async function decryptEnvelope(secret, envelope) {
  return decryptWithKey(await keyForEnvelope(secret, envelope), envelope);
}
