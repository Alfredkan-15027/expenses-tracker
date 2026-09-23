// App lock: 6-digit passcode (only a salted PBKDF2 hash is stored), optional Face ID / Touch ID via a
// device passkey (WebAuthn platform authenticator), and an adjustable auto-lock delay.
// Face ID here is a local gate that opens the app; it does not encrypt the data on the device.
import { getKV, setKV, deleteKV } from './db.js';

const KEY = 'lock';
const ITERATIONS = 150_000;
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;
export const PIN_LENGTH = 6;

export const AUTO_LOCK_OPTIONS = [
  { id: 0, label: '立即' },
  { id: 60_000, label: '1 分钟' },
  { id: 300_000, label: '5 分钟' },
  { id: 900_000, label: '15 分钟' },
  { id: 3_600_000, label: '1 小时' },
];
const DEFAULT_AUTO_LOCK = 60_000;

let cache = null;
let memoryOnly = false; // demo mode never touches the real database

export function setMemoryOnly(v) { memoryOnly = v; }

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function derive(pin, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations }, key, 256);
  return hex(bits);
}

async function load() {
  if (cache) return cache;
  cache = (memoryOnly ? null : await getKV(KEY).catch(() => null)) || { enabled: false };
  return cache;
}

async function save(v) {
  cache = v;
  if (!memoryOnly) await setKV(KEY, v);
}

export async function isEnabled() {
  return (await load()).enabled === true;
}

/** Public view of the lock settings (never includes the hash). */
export async function getInfo() {
  const v = await load();
  return {
    enabled: v.enabled === true,
    pinLength: v.enabled ? v.pinLength || 4 : PIN_LENGTH, // records from before v1.1 used 4 digits
    autoLockMs: Number.isFinite(v.autoLockMs) ? v.autoLockMs : DEFAULT_AUTO_LOCK,
    biometric: v.enabled === true && !!v.biometric?.credId,
  };
}

export async function setPin(pin) {
  const prev = await load();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(pin, salt, ITERATIONS);
  await save({
    enabled: true, salt, hash, iterations: ITERATIONS, pinLength: pin.length, failed: 0, lockedUntil: 0,
    autoLockMs: Number.isFinite(prev.autoLockMs) ? prev.autoLockMs : DEFAULT_AUTO_LOCK,
    biometric: prev.enabled ? prev.biometric || null : null,
  });
}

export async function disable() {
  cache = { enabled: false };
  if (!memoryOnly) await deleteKV(KEY);
}

export async function setAutoLock(ms) {
  const v = await load();
  await save({ ...v, autoLockMs: ms });
}

export async function getAutoLockMs() {
  return (await getInfo()).autoLockMs;
}

/** Returns { ok } or { ok: false, wait: ms, left: attemptsLeft }. */
export async function verify(pin) {
  const v = await load();
  if (!v.enabled) return { ok: true };
  const now = Date.now();
  if (v.lockedUntil && v.lockedUntil > now) return { ok: false, wait: v.lockedUntil - now, left: 0 };
  const hash = await derive(pin, v.salt, v.iterations || ITERATIONS);
  if (hash === v.hash) {
    if (v.failed) await save({ ...v, failed: 0, lockedUntil: 0 });
    return { ok: true };
  }
  const failed = (v.failed || 0) + 1;
  if (failed >= MAX_ATTEMPTS) {
    await save({ ...v, failed: 0, lockedUntil: now + COOLDOWN_MS });
    return { ok: false, wait: COOLDOWN_MS, left: 0 };
  }
  await save({ ...v, failed });
  return { ok: false, left: MAX_ATTEMPTS - failed };
}

// ── Face ID / Touch ID (passkey on this device) ─────────────────────────────

export async function biometricAvailable() {
  try {
    return !!window.PublicKeyCredential
      && await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * One stable passkey user handle per install, kept even when the lock is turned off: creating a passkey again
 * with the same handle replaces the old one in the iPhone Passwords app instead of adding another.
 */
async function passkeyUserId() {
  let id = memoryOnly ? null : await getKV('passkeyUser').catch(() => null);
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) {
    id = hex(crypto.getRandomValues(new Uint8Array(16)));
    if (!memoryOnly) await setKV('passkeyUser', id);
  }
  return unhex(id);
}

/** Create a device passkey for this app (iPhone asks for Face ID and offers to save it). */
export async function enableBiometric() {
  const v = await load();
  if (!v.enabled) throw new Error('请先设定密码');
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Expenses Tracker', id: location.hostname },
      user: { id: await passkeyUserId(), name: 'Expenses Tracker 解锁', displayName: 'Expenses Tracker' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('没有建立 Face ID');
  await save({ ...v, biometric: { credId: b64u(cred.rawId), createdAt: Date.now() } });
}

export async function disableBiometric() {
  const v = await load();
  await save({ ...v, biometric: null });
}

/** Ask for Face ID. Returns { ok } or { ok: false, reason }. */
export async function unlockWithBiometric() {
  const v = await load();
  const credId = v.biometric?.credId;
  if (!v.enabled || !credId) return { ok: false, reason: 'not-set' };
  try {
    const a = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: unb64u(credId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    if (!a || b64u(a.rawId) !== credId) return { ok: false, reason: 'mismatch' };
    // authenticatorData byte 32 holds the flags; bit 2 (0x04) = user verified (Face ID / passcode of the phone).
    const flags = new Uint8Array(a.response.authenticatorData)[32];
    if (!(flags & 0x04)) return { ok: false, reason: 'not-verified' };
    if (v.failed) await save({ ...v, failed: 0, lockedUntil: 0 });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.name === 'NotAllowedError' ? 'cancelled' : 'error' };
  }
}

export function forget() { cache = null; }
