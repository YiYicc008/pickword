/* 应用入口 */

import { load, subscribe, getBooks, getBook, getClusters, DEMO_MODE } from './store.js';
import { vs, selectBook, lastBook } from './viewstate.js';
import { $ } from './util.js';
import { toast } from './ui.js';
import {
  render, renderSidebar, renderTopbar, renderListOnly, renderAfterDataChange,
  openSettingsDialog, openSyncDialog, openAboutDialog, openBookDialog, closeSidebar,
} from './views.js';
import { openAddWordDialog } from './entry.js';

function boot() {
  load();

  if (DEMO_MODE) {
    window.addEventListener('error', (e) => {
      const box = document.createElement('pre');
      box.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:99999;background:#fff0ee;color:#8c2b1c;' +
        'padding:8px;font:12px/1.5 monospace;max-width:62%;white-space:pre-wrap;' +
        'border:1px solid #b8452f;border-radius:8px';
      box.textContent = 'JS ERROR: ' + e.message + String.fromCharCode(10) + ((e.error && e.error.stack) || '');
      document.body.appendChild(box);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const box = document.createElement('pre');
      box.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:99999;background:#fff0ee;color:#8c2b1c;' +
        'padding:8px;font:12px/1.5 monospace;max-width:62%;white-space:pre-wrap;' +
        'border:1px solid #b8452f;border-radius:8px';
      const r = e.reason;
      box.textContent = 'JS REJECT: ' + ((r && (r.message || r)) || '') + String.fromCharCode(10) + ((r && r.stack) || '');
      document.body.appendChild(box);
    });
  }

  const books = getBooks();
  if (!books.length) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">数据加载失败，请清空浏览器存储后重试。</p>';
    return;
  }
  const remembered = lastBook();
  selectBook(getBook(remembered) ? remembered : books[0].id);

  const params = new URLSearchParams(location.search);
  if (params.get('view') === 'cloud') vs.view = 'cloud';
  const pendingAction = params.get('action');

  wire();
  render();

  if (pendingAction === 'new-book') setTimeout(() => openBookDialog(), 120);
  registerSW();

  if (DEMO_MODE) {
    const modal = params.get('modal');
    if (modal) {
      setTimeout(() => {
        if (modal === 'add') openAddWordDialog({ preselectBookId: vs.bookId });
        else if (modal === 'settings') openSettingsDialog();
        else if (modal === 'sync') openSyncDialog();
        else if (modal === 'about') openAboutDialog();
        else if (modal === 'manager') import('./cloudview.js').then((m) => m.openClusterManager(vs.bookId));
        else if (modal === 'clusteredit') {
          import('./cloudview.js').then((m) => {
            const c = getClusters(vs.bookId)[0];
            if (c) m.openClusterEditor(vs.bookId, c, () => {});
          });
        } else if (modal === 'word') {
          Promise.all([import('./store.js'), import('./views.js')]).then(([st, vw]) => {
            const book = getBook(vs.bookId) || getBooks()[0];
            const list = st.getEntriesOfBook(book.id).slice().sort((a, b) => b.weight - a.weight);
            if (list[0]) vw.openWordDetail(list[0].wordId, book.id);
          });
        }
      }, 80);
    }
    import('./demo.js')
      .then((m) => {
        if (m.seedDemo()) {
          selectBook(getBooks()[0].id);
          render();
          toast('已载入示例数据', 'success', 2600);
        }
      })
      .catch((e) => console.warn('[demo] 载入失败', e));
  }
}

function wire() {
  const bind = (id, ev, fn) => {
    const node = document.getElementById(id);
    if (node) node.addEventListener(ev, fn);
  };

  bind('add-book', 'click', () => openBookDialog());
  bind('add-book-2', 'click', () => openBookDialog());
  bind('btn-settings', 'click', openSettingsDialog);
  bind('btn-sync', 'click', openSyncDialog);
  bind('btn-about', 'click', openAboutDialog);
  bind('scrim', 'click', closeSidebar);

  // 数据变化：列表局部刷新；词云视图整体重建
  let queued = false;
  subscribe(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (vs.view === 'list') renderListOnly();
      renderSidebar();
      renderTopbar();
    });
  });

  window.addEventListener('vn:data-changed', () => {
    if (vs.view === 'cloud') render();
    else renderAfterDataChange();
  });

  window.addEventListener('vn:auth-changed', () => {
    renderTopbar();
  });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      closeSidebar();
      return;
    }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      focusSearch();
      return;
    }
    if (!typing && e.key === '/') {
      e.preventDefault();
      focusSearch();
      return;
    }
    if (!typing && !mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openAddWordDialog({ preselectBookId: vs.bookId });
    }
  });

  // 移动端：滑动 / 点击遮罩关闭抽屉已绑定；这里补一个手势
  let tx = 0;
  document.addEventListener('touchstart', (e) => { tx = e.touches[0]?.clientX || 0; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const dx = (e.changedTouches[0]?.clientX || 0) - tx;
    if (dx < -60 && vs.sidebarOpen) closeSidebar();
  }, { passive: true });
}

function focusSearch() {
  if (vs.view !== 'list') { vs.view = 'list'; render(); }
  const input = document.getElementById('search-input');
  if (input) { input.focus(); input.select(); }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[sw] 注册失败', e));
  });
}

function start() {
  try {
    boot();
    window.__vnBooted = true;
  } catch (err) {
    console.error('[boot] 启动失败', err);
    if (window.__vnShowBootFail) window.__vnShowBootFail(err && err.message);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
