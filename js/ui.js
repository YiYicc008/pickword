/* 图标、Toast、弹层等通用 UI 组件 */

import { $, el } from './util.js';

const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 9.3 4.5 4.5 0 0 0 6.5 19h11Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="2.4"/>',
  graph: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/>',
  volume: '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  pencil: '<path d="M4 20h4L20 8a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z"/>',
  sparkles: '<path d="M12 3.5 13.7 8 18 9.7 13.7 11.4 12 16l-1.7-4.6L6 9.7 10.3 8 12 3.5Z"/><path d="M18.5 15.5 19.4 18l2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9.9-2.5Z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19h16"/>',
  upload: '<path d="M12 20V9M7.5 13.5 12 9l4.5 4.5"/><path d="M4 5h16"/>',
  check: '<path d="m5 13 4.5 4.5L19 7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 5v6h-6"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2M11 8v6M8 11h6"/>',
  maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01" stroke-width="2.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  weight: '<path d="M12 4v16M7 9l5-5 5 5"/>',
  flame: '<path d="M12 3c.5 3 2 4 3.5 5.5A5.5 5.5 0 0 1 17 13a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1 .8 1.6 1.5 2 .5-2.5.5-5 1.5-7.5Z"/>',
  sync: '<path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4"/><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4"/><path d="M21 4v5h-5M3 20v-5h5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7.5 14h9"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97 6 6 0 0 0-2.8-4.4"/><path d="M6.2 9.3A4.5 4.5 0 0 0 6.5 19h6"/>',
};

export function icon(name, size = 18, extraClass = '') {
  return `<svg class="${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export const svgEl = (name, size = 18) => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icon(name, size);
  return wrap.firstElementChild;
};

/* ---------------- Toast ---------------- */

export function toast(message, type = 'default', duration = 2400) {
  const root = $('#toast-root');
  const node = el('div', { class: `toast ${type}` });
  if (type === 'success') node.innerHTML = icon('check', 16);
  else if (type === 'error') node.innerHTML = icon('info', 16);
  node.append(el('span', { text: message }));
  root.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  }, duration);
  return node;
}

/* ---------------- 弹层 ---------------- */

let openCount = 0;

export function openModal({ title, subtitle, body, footer, wide = false, onClose, closable = true }) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' });

  const head = el('div', { class: 'modal-head' });
  const titleWrap = el('div', { style: 'flex:1;min-width:0' });
  if (title) titleWrap.appendChild(el('h2', { class: 'modal-title', text: title }));
  if (subtitle) titleWrap.appendChild(el('div', { class: 'modal-sub', text: subtitle }));
  head.appendChild(titleWrap);
  if (closable) {
    const closeBtn = el('button', { class: 'modal-close', 'aria-label': '关闭' });
    closeBtn.innerHTML = icon('x', 18);
    closeBtn.addEventListener('click', close);
    head.appendChild(closeBtn);
  }
  modal.appendChild(head);

  const bodyEl = el('div', { class: 'modal-body' });
  if (body) bodyEl.append(body);
  modal.appendChild(bodyEl);

  if (footer) {
    const foot = el('div', { class: 'modal-foot' });
    foot.append(footer);
    modal.appendChild(foot);
  }

  backdrop.appendChild(modal);
  $('#modal-root').appendChild(backdrop);
  openCount++;
  document.body.style.overflow = 'hidden';

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    openCount = Math.max(0, openCount - 1);
    if (!openCount) document.body.style.overflow = '';
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }

  function onKey(e) {
    if (e.key === 'Escape' && closable) { e.stopPropagation(); close(); }
  }
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop && closable) close();
  });

  setTimeout(() => {
    const focusable = modal.querySelector('input, textarea, select, button.btn-primary');
    focusable?.focus({ preventScroll: true });
  }, 60);

  return { close, modal, body: bodyEl, setTitle: (t) => { titleWrap.querySelector('.modal-title').textContent = t; } };
}

export function confirmDialog({ title, message, confirmText = '确认', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); ref.close(); } };

    const foot = el('div', { style: 'display:flex;gap:9px;width:100%;justify-content:flex-end' });
    const cancel = el('button', { class: 'btn btn-quiet', text: cancelText });
    const ok = el('button', {
      class: `btn ${danger ? 'btn-primary' : 'btn-primary'}`,
      text: confirmText,
      style: danger ? 'background:#8f3322' : '',
    });
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    foot.append(cancel, ok);

    const ref = openModal({
      title,
      body: el('p', { text: message, style: 'margin:0 0 6px;font-size:14px;color:var(--ink-2);line-height:1.7;white-space:pre-line' }),
      footer: foot,
      onClose: () => { if (!settled) { settled = true; resolve(false); } },
    });
  });
}

export function promptDialog({ title, message, value = '', placeholder = '', confirmText = '确定' }) {
  return new Promise((resolve) => {
    let settled = false;
    const input = el('input', { class: 'text-input', value, placeholder, maxlength: '60' });
    const done = (v) => { if (!settled) { settled = true; resolve(v); ref.close(); } };

    const foot = el('div', { style: 'display:flex;gap:9px;width:100%;justify-content:flex-end' });
    const cancel = el('button', { class: 'btn btn-quiet', text: '取消' });
    const ok = el('button', { class: 'btn btn-primary', text: confirmText });
    cancel.addEventListener('click', () => done(null));
    ok.addEventListener('click', () => done(input.value.trim() || null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
    });
    foot.append(cancel, ok);

    const body = el('div', {});
    if (message) body.appendChild(el('p', { text: message, style: 'margin:0 0 10px;font-size:13.5px;color:var(--ink-2)' }));
    body.appendChild(input);

    const ref = openModal({
      title, body, footer: foot,
      onClose: () => { if (!settled) { settled = true; resolve(null); } },
    });
    setTimeout(() => { input.focus(); input.select(); }, 80);
  });
}
