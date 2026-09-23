// How-to sheets: install to Home Screen, daily reminder, privacy.
import { html, icon } from '../html.js';
import { openSheet } from '../overlays.js';

export function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

const step = (n, title, body, ic) => html`<li class="steps__item">
  <span class="steps__num">${n}</span>
  <div class="steps__text"><strong>${title}</strong>${body ? html`<p>${body}</p>` : ''}</div>
  ${ic ? html`<span class="steps__icon">${icon(ic)}</span>` : ''}
</li>`;

export function openInstallGuide() {
  openSheet({
    title: '添加到主屏幕',
    size: 'medium',
    body: html`<div class="prose">
      <p>装到主屏幕后，Expenses Tracker 会像普通 App 一样全屏打开、离线可用，iOS 也会更好地保留你的资料。</p>
      <ol class="steps">
        ${step(1, '用 Safari 打开这个网页', '其他浏览器（例如 Chrome 或 App 内置浏览器）无法添加。')}
        ${step(2, '点底部工具栏的「分享」按钮', '如果看不到工具栏，轻点一下屏幕底部。', 'share')}
        ${step(3, '往下滑，选择「添加到主屏幕」', null, 'add-home')}
        ${step(4, '确认名称，点右上角「添加」', '之后从主屏幕的图标打开就可以了。', 'check')}
      </ol>
      <p class="callout">${icon('info')}<span>请从主屏幕图标打开，而不是 Safari。两边的资料是分开存放的。</span></p>
    </div>`,
  });
}

export function openReminderGuide() {
  openSheet({
    title: '每日记账提醒',
    size: 'large',
    body: html`<div class="prose">
      <p>网页 App 要发推送需要服务器，会产生费用和资料外流的风险，所以这里用 iPhone 自带的功能来提醒，完全免费，也不需要任何权限。</p>
      <h3>方法一：提醒事项（最简单）</h3>
      <ol class="steps">
        ${step(1, '打开「提醒事项」App，新增一个提醒', '例如：「记账 · 今天花了什么？」')}
        ${step(2, '点「ⓘ」，打开「日期」和「时间」', '建议设在每晚 9:30，睡前一次记完。', 'clock')}
        ${step(3, '「重复」选择「每天」', '完成后每天都会准时提醒你。', 'bell')}
      </ol>
      <h3>方法二：快捷指令自动化</h3>
      <ol class="steps">
        ${step(1, '打开「快捷指令」→ 底部「自动化」→ 右上角「＋」')}
        ${step(2, '选择「特定时间」，设定 21:30、「每天」，并选「立即运行」')}
        ${step(3, '加入「显示通知」动作', '内容写：「打开 Expenses 记一下今天的开销 ✍️」')}
      </ol>
      <h3>让记账更顺手的小技巧</h3>
      <ul class="tips">
        <li>把 Expenses 图标放进 Dock，随手就能点到。</li>
        <li>花钱的当下记最准确；忘了的话，晚上提醒时补记，日期可以改成昨天。</li>
        <li>常记的项目（例如「午餐 RM 12」）会自动出现在「今天」页的「常用」里，点一下就记好。</li>
        <li>房租、手机月费、订阅这类每月固定的，到「设置 → 固定项目」设一次，之后自动记录。</li>
      </ul>
    </div>`,
  });
}

export function openPrivacySheet() {
  openSheet({
    title: '隐私与资料安全',
    size: 'large',
    body: html`<div class="prose">
      <p class="callout callout--good">${icon('shield')}<span>你的所有记录只存在这台 iPhone 上，不会上传到任何服务器。</span></p>
      <ul class="tips">
        <li><strong>没有账号、没有服务器、没有追踪。</strong>App 不会连接任何第三方服务，也不含广告或统计代码。</li>
        <li><strong>网址公开也没关系。</strong>别人打开同一个网址，只会看到一个全新的空白 App，看不到你的资料。</li>
        <li><strong>可以加密码锁。</strong>在「设置 → 密码锁」开启后，每次打开或离开超过 1 分钟都需要输入密码。</li>
        <li><strong>备份由你掌控。</strong>备份文件只会存到你选择的位置（例如 iCloud 云盘），请妥善保管。</li>
      </ul>
      <h3>什么情况下资料会消失？</h3>
      <ul class="tips">
        <li>删除主屏幕上的 App 图标。</li>
        <li>在「设置 → Safari → 清除历史记录与网站数据」。</li>
        <li>换新手机时没有先备份。</li>
      </ul>
      <p>所以建议每两周备份一次，App 会在需要时提醒你。</p>
    </div>`,
  });
}
