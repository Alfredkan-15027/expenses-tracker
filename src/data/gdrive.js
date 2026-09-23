// Google Drive backups in the app-private "appDataFolder" (invisible in Drive; only this app can read it).
// Sign-in uses the OAuth 2.0 redirect flow (no pop-ups — they are unreliable in iOS home-screen apps).
// The access token lives in memory only and expires after about an hour; it is never stored.
// This module is the ONLY place the app talks to an outside server, and only when the user backs up/restores.
import { getKV, setKV, deleteKV } from './db.js';

export const CLIENT_ID = '824589096781-3vh32s4rifmkt026v3t59775pudmf4bh.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const PENDING_KEY = 'oauthPending';
export const KEEP_BACKUPS = 10;
const FILE_PREFIX = 'expenses-tracker-';

let token = null; // { value, exp }

// When the user last touched the app while it was open and unlocked. A trip to Google's sign-in page counts
// like a short app switch measured from this moment — never from when the redirect happened to start.
let presentAt = 0;
const unlockedAndVisible = () => {
  const c = document.documentElement.classList;
  return document.visibilityState === 'visible' && !c.contains('is-locked') && !c.contains('is-concealed');
};
if (typeof document !== 'undefined') {
  const mark = () => { if (unlockedAndVisible()) presentAt = Date.now(); };
  document.addEventListener('pointerdown', mark, true);
  document.addEventListener('keydown', mark, true);
}

export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function hasToken() {
  return !!token && token.exp > Date.now() + 30_000;
}

export function forgetToken() {
  token = null;
}

function randomState() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Leave the app for Google's sign-in page. `action` is resumed after returning: 'backup' | 'restore' | 'connect'.
 * silent: ask Google to answer without showing anything (works when already signed in and allowed); if Google
 * needs the user, consumeRedirect() reports `retry` and the normal page is opened instead.
 * Returns false (and stays) when the app is locked or hidden: a sign-in may only start from an unlocked app.
 */
export async function beginAuth(action, { returnHash = '#/settings', silent = false, present = presentAt } = {}) {
  if (!unlockedAndVisible()) return false;
  const state = randomState();
  await setKV(PENDING_KEY, { state, action, returnHash, silent, at: Date.now(), presentAt: present });
  if (!unlockedAndVisible()) { await deleteKV(PENDING_KEY).catch(() => {}); return false; }
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (silent) p.set('prompt', 'none');
  location.assign(`${AUTH_URL}?${p.toString()}`);
}

const NEEDS_USER = ['interaction_required', 'login_required', 'consent_required', 'account_selection_required'];

/**
 * Parse an OAuth redirect in the URL fragment (call before the router reads location.hash).
 * Returns null when this page load is not an OAuth return; otherwise
 * { ok, action, error, retry, returnHash, presentAt } — presentAt (when the user last used the unlocked app
 * before leaving) is only set when the reply matches a sign-in this app started, so the caller may treat the
 * trip like a short app switch.
 */
export async function consumeRedirect() {
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  const pending = await getKV(PENDING_KEY).catch(() => null);
  await deleteKV(PENDING_KEY).catch(() => {});
  const cleanHash = pending?.returnHash || '#/settings';
  history.replaceState(null, '', location.pathname + location.search + cleanHash);
  if (!pending || p.get('state') !== pending.state || Date.now() - pending.at > 15 * 60_000) {
    return { ok: false, action: pending?.action || null, error: '登录验证失败，请再试一次。' };
  }
  const base = { action: pending.action, returnHash: cleanHash, presentAt: Number(pending.presentAt) || 0 };
  const err = p.get('error');
  if (err) {
    if (pending.silent && NEEDS_USER.includes(err)) return { ...base, ok: false, retry: true };
    return { ...base, ok: false, error: err === 'access_denied' ? '你取消了 Google 授权。' : 'Google 授权失败，请再试一次。' };
  }
  const value = p.get('access_token');
  const expiresIn = Number(p.get('expires_in')) || 3600;
  const granted = (p.get('scope') || '').split(' ');
  if (!value || (granted.length && granted[0] && !granted.includes(SCOPE))) {
    return { ...base, ok: false, error: '没有取得 Google Drive 权限，请在授权画面勾选允许。' };
  }
  token = { value, exp: Date.now() + expiresIn * 1000 };
  return { ...base, ok: true };
}

async function api(url, opts = {}) {
  if (!hasToken()) throw Object.assign(new Error('需要重新连接 Google'), { code: 'auth' });
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token.value}` } });
  if (res.status === 401) {
    token = null;
    throw Object.assign(new Error('Google 登录已过期'), { code: 'auth' });
  }
  if (!res.ok) throw Object.assign(new Error(`Google Drive 错误 (${res.status})`), { code: 'http', status: res.status });
  return res;
}

/** Upload one encrypted backup file; returns { id, name, createdTime }. */
export async function uploadBackup(text, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const name = `${FILE_PREFIX}${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.etbackup`;
  const boundary = `et-${randomState()}`;
  const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id,name,createdTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.json();
}

export async function listBackups() {
  const q = new URLSearchParams({
    spaces: 'appDataFolder',
    orderBy: 'createdTime desc',
    pageSize: '50',
    fields: 'files(id,name,createdTime,size)',
  });
  const res = await api(`${API}/files?${q.toString()}`);
  const data = await res.json();
  return (data.files || []).filter((f) => f.name?.startsWith(FILE_PREFIX));
}

export async function downloadBackup(id) {
  const res = await api(`${API}/files/${encodeURIComponent(id)}?alt=media`);
  return res.text();
}

/** Keep only the newest KEEP_BACKUPS files. */
export async function pruneBackups() {
  const files = await listBackups();
  for (const f of files.slice(KEEP_BACKUPS)) {
    await api(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' }).catch(() => {});
  }
}
