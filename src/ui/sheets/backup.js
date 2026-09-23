// Backup (JSON), restore, and CSV export. Files go only where the user chooses (share sheet / Files).
import { html, icon } from '../html.js';
import { openSheet, toast, confirmDialog, alertDialog } from '../overlays.js';
import { haptic } from '../haptics.js';
import { state, snapshot, saveSettings, replaceAllData } from '../../data/store.js';
import { buildBackup, backupFilename, parseBackup, toCSV } from '../../core/backup.js';

const MAX_IMPORT_BYTES = 30 * 1024 * 1024;

function lastBackupText() {
  const t = state.settings.lastBackupAt;
  if (!t) return '还没有备份过';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  return days === 0 ? '今天已备份' : `上次备份：${days} 天前`;
}

/** Hand a file to the iOS share sheet (Save to Files / AirDrop), falling back to a download. */
async function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export async function exportBackup() {
  if (state.demo) { toast('演示模式不能备份', { icon: 'info' }); return; }
  const text = JSON.stringify(buildBackup(snapshot()));
  const ok = await saveFile(backupFilename(), text, 'application/json');
  if (ok) {
    await saveSettings({ lastBackupAt: Date.now() });
    haptic('success');
    toast('备份已导出', { icon: 'check', tone: 'success' });
  }
}

export async function exportCSV() {
  const csv = toCSV(state.transactions, state.categories);
  const d = new Date();
  const name = `expenses-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
  if (await saveFile(name, csv, 'text/csv')) toast('CSV 已导出', { icon: 'check', tone: 'success' });
}

export function importBackup() {
  if (state.demo) { toast('演示模式不能还原', { icon: 'info' }); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { await alertDialog({ title: '文件太大', message: '这不像是 Expenses Tracker 的备份文件。' }); return; }
    const result = parseBackup(await file.text());
    if (!result.ok) { haptic('error'); await alertDialog({ title: '无法还原', message: result.error }); return; }
    const d = result.data;
    const when = result.exportedAt ? new Date(result.exportedAt).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '未知时间';
    const ok = await confirmDialog({
      title: '用这个备份取代目前的资料？',
      message: `备份时间：${when}\n${d.transactions.length} 笔记录 · ${d.categories.length} 个类别 · ${d.recurring.length} 个固定项目\n\n目前手机里的资料会被完全取代，建议先备份一次。`,
      confirm: '还原', destructive: true,
    });
    if (!ok) return;
    await replaceAllData({ ...d, settings: { ...d.settings, onboarded: true } });
    haptic('success');
    toast(result.dropped ? `已还原（略过 ${result.dropped} 笔无效资料）` : '已还原', { icon: 'check', tone: 'success' });
  };
  input.click();
}

export function openBackupSheet() {
  openSheet({
    title: '备份与导出',
    size: 'medium',
    body: html`<div class="stack">
      <p class="callout">${icon('shield')}<span>资料只存在这台手机。建议每两周备份一次到 iCloud 云盘（在分享菜单选「存储到文件」）。<br><strong>${lastBackupText()}</strong></span></p>
      <ul class="list">
        <li><button type="button" class="row" data-do="backup">${icon('upload', 'row__glyph')}<span class="row__body"><span class="row__title">立即备份</span><span class="row__subtitle">导出完整资料（JSON），可在新手机还原</span></span>${icon('chevron-right', 'row__chevron')}</button></li>
        <li><button type="button" class="row" data-do="restore">${icon('download', 'row__glyph')}<span class="row__body"><span class="row__title">从备份还原</span><span class="row__subtitle">选择之前导出的备份文件</span></span>${icon('chevron-right', 'row__chevron')}</button></li>
        <li><button type="button" class="row" data-do="csv">${icon('list', 'row__glyph')}<span class="row__body"><span class="row__title">导出 CSV</span><span class="row__subtitle">用 Numbers／Excel 打开所有记录</span></span>${icon('chevron-right', 'row__chevron')}</button></li>
      </ul>
    </div>`,
    onMount(el, api) {
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-do]');
        if (!b) return;
        if (b.dataset.do === 'backup') { await exportBackup(); api.close(); }
        if (b.dataset.do === 'restore') { api.close(); importBackup(); }
        if (b.dataset.do === 'csv') { await exportCSV(); }
      });
    },
  });
}
