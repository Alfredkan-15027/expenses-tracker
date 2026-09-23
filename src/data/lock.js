// Optional 4-digit passcode. Only a salted PBKDF2 hash is stored — never the passcode itself.
import { getKV, setKV, deleteKV } from './db.js';

const KEY = 'lock';
const ITERATIONS = 150_000;
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;

let cache = null;
let memoryOnly = false; // demo mode never touches the real database

export function setMemoryOnly(v) { memoryOnly = v; }

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

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

export async function setPin(pin) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(pin, salt, ITERATIONS);
  await save({ enabled: true, salt, hash, iterations: ITERATIONS, failed: 0, lockedUntil: 0 });
}

export async function disable() {
  cache = { enabled: false };
  if (!memoryOnly) await deleteKV(KEY);
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

export function forget() { cache = null; }
