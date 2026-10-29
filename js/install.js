/* 安装（PWA）支持
 * 目标：在支持的浏览器里给出一个「安装」按钮，在不支持的浏览器里给出准确的手动指引。
 * 设计：本模块只做三件事——捕获 beforeinstallprompt、提供安装入口、判断当前是否已安装。
 * 不依赖任何第三方库，也不改变已有的渲染逻辑。 */

let deferredPrompt = null;

const STANDALONE_QUERIES = [
  '(display-mode: standalone)',
  '(display-mode: window-controls-overlay)',
  '(display-mode: minimal-ui)',
];

window.addEventListener('beforeinstallprompt', (event) => {
  // 阻止浏览器自带的横幅，改为由应用内的按钮触发
  event.preventDefault();
  deferredPrompt = event;
  window.dispatchEvent(new CustomEvent('vn:installable'));
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  window.dispatchEvent(new CustomEvent('vn:installed'));
});

/** 当前是否以独立窗口运行（即已经安装并从桌面图标启动） */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.navigator.standalone === true) return true; // iOS Safari
  return STANDALONE_QUERIES.some((q) => {
    try {
      return window.matchMedia(q).matches;
    } catch (err) {
      return false;
    }
  });
}

/** 当前环境是否可以直接弹出安装提示 */
export function canPromptInstall() {
  return Boolean(deferredPrompt);
}

/** 当前设备的大致类型，用于给出对应的安装指引 */
export function platformKind() {
  const ua = String(navigator.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/HarmonyOS|OpenHarmony/i.test(ua)) return 'harmony';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

/** 一句话描述当前该怎么做，用于「关于」弹窗与提示 */
export function installHint() {
  if (isStandalone()) return '已经以独立窗口运行。';
  if (canPromptInstall()) return '可直接安装为桌面应用。';
  const kind = platformKind();
  if (kind === 'ios') return '在 Safari 中点「分享」→「添加到主屏幕」。';
  if (kind === 'android') return '在浏览器菜单中选择「安装应用」或「添加到主屏幕」。';
  if (kind === 'harmony') return '在浏览器菜单中选择「添加到桌面」；较新的鸿蒙系统可能没有系统级安装入口。';
  if (kind === 'windows' || kind === 'mac' || kind === 'linux') {
    return '在浏览器地址栏右侧点击「安装」图标，或使用菜单中的「安装拾词」。';
  }
  return '在浏览器菜单中选择「安装应用」或「添加到主屏幕」。';
}

/**
 * 触发安装。返回 'accepted' | 'dismissed' | 'unavailable'。
 * 浏览器只允许在用户手势中调用，因此调用方必须来自点击事件。
 */
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null;
  try {
    event.prompt();
    const choice = await event.userChoice;
    return (choice && choice.outcome) || 'dismissed';
  } catch (err) {
    console.warn('[install] 安装提示失败', err);
    return 'unavailable';
  }
}
