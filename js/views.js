/* 主界面视图：侧边栏、顶部、列表、详情、设置 */

import {
  getBooks, getBook, getEntriesOfBook, getEntry, getWord, bookStats,
  addTerm, removeEntry, adjustWeight, updateWord, updateBook, deleteBook,
  clearBook, createBook, getLinks, addLink, removeLink, getBooksOfWord,
  getSettings, updateSettings, exportJSON, importJSON, REL_TYPES,
  getWordByTerm, DEMO_MODE,
} from './store.js';
import { vs, selectBook } from './viewstate.js';
import { icon, toast, openModal, confirmDialog, promptDialog } from './ui.js';
import { $, el, formatDate, relativeTime, esc } from './util.js';
import { pronounce, enrichTerm, missingInfo, wasRateLimited } from './dict.js';
import { openAddWordDialog } from './entry.js';
import { PROVIDERS, hasAI, testConnection, translateWord, translateSenses, describeWord } from './ai.js';
import {
  syncNow, pullRemote, pushOverride, signIn, signUp, signInAnon, signOut,
  authSummary, syncConfig, SYNC_SQL,
} from './sync.js';

import { posAbbr, posTag, posClass, weightClass, sensesSig } from './format.js';
import { Transfer } from './p2p.js';

export { posAbbr, weightClass };

/** 两个中文串的汉字重合度（0~1），用来判断两条释义是不是同一个意思 */
function zhOverlap(a, b) {
  const chars = (t) => Array.from(new Set(String(t || '').replace(/[^一-鿿]/g, '')));
  const A = chars(a);
  if (!A.length) return 0;
  const bs = new Set(chars(b));
  let hit = 0;
  for (const c of A) if (bs.has(c)) hit++;
  return hit / A.length;
}

/* ==================== 侧边栏 ==================== */

export function renderSidebar() {
  const nav = $('#book-list');
  nav.innerHTML = '';
  for (const b of getBooks()) {
    const stats = bookStats(b.id);
    const btn = el('button', {
      class: `book-item${b.id === vs.bookId ? ' active' : ''}`,
      style: `--book-color:${b.color}`,
      title: b.name,
    });
    btn.append(
      el('span', { class: 'book-name', text: b.name }),
      el('span', { class: 'book-count', text: String(stats.count) })
    );
    btn.addEventListener('click', () => { selectBook(b.id); closeSidebar(); render(); });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openBookMenu(b);
    });
    nav.appendChild(btn);
  }
}

function openBookMenu(book) {
  const body = el('div', {});
  const row = (label, iconName, action, danger = false) => {
    const b = el('button', {
      class: 'ghost-btn',
      style: `width:100%;justify-content:flex-start;padding:11px 12px;${danger ? 'color:var(--accent)' : ''}`,
    });
    b.innerHTML = icon(iconName, 17) + `<span style="margin-left:9px">${label}</span>`;
    b.addEventListener('click', () => { ref.close(); action(); });
    return b;
  };
  const bodyWrap = el('div', { style: 'display:flex;flex-direction:column;gap:2px' },
    row('重命名', 'pencil', () => openBookDialog(book)),
    row('清空本内单词', 'trash', async () => {
      if (await confirmDialog({ title: '清空单词本', message: `将移除「${book.name}」中的全部 ${bookStats(book.id).count} 个词条，此操作不可撤销（其他单词本不受影响）。`, confirmText: '清空', danger: true })) {
        clearBook(book.id); toast('已清空', 'success');
      }
    }),
    row('删除单词本', 'trash', async () => {
      if (await confirmDialog({ title: '删除单词本', message: `确定删除「${book.name}」及其全部词条吗？此操作不可撤销。`, confirmText: '删除', danger: true })) {
        const r = deleteBook(book.id);
        if (!r.ok) { toast(r.reason, 'error'); return; }
        if (vs.bookId === book.id) selectBook(getBooks()[0]?.id);
        toast('已删除', 'success');
      }
    }, true)
  );
  const ref = openModal({ title: `「${book.name}」`, body: bodyWrap });
}

export function openBookDialog(book = null) {
  const input = el('input', {
    class: 'text-input big', value: book?.name || '', placeholder: '例如：考研核心词 / 商务英语 / 小说生词',
    maxlength: '40',
  });
  const colors = ['#b8452f', '#2f5d7c', '#3f7d5a', '#c98a2e', '#6b5b95', '#a04b6b', '#3a7b8c', '#8b6f3a'];
  let chosen = book?.color || colors[getBooks().length % colors.length];
  const swatches = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:4px' });
  const renderSwatches = () => {
    swatches.innerHTML = '';
    for (const c of colors) {
      const s = el('button', {
        style: `width:26px;height:26px;border-radius:8px;background:${c};${chosen === c ? 'outline:2px solid var(--ink);outline-offset:2px;' : 'opacity:.85'}`,
        title: c,
      });
      s.addEventListener('click', () => { chosen = c; renderSwatches(); });
      swatches.appendChild(s);
    }
  };
  renderSwatches();

  const body = el('div', {},
    el('div', { class: 'field' },
      el('div', { class: 'field-label' }, el('span', { text: '名称' })),
      input
    ),
    el('div', { class: 'field' },
      el('div', { class: 'field-label' }, el('span', { text: '标记色' })),
      swatches
    )
  );

  const foot = el('div', { style: 'display:flex;gap:9px;width:100%;justify-content:flex-end' });
  const cancel = el('button', { class: 'btn btn-quiet', text: '取消' });
  const ok = el('button', { class: 'btn btn-primary', text: book ? '保存' : '创建' });
  cancel.addEventListener('click', () => ref.close());
  ok.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  foot.append(cancel, ok);

  const ref = openModal({
    title: book ? '编辑单词本' : '新建单词本',
    subtitle: '给单词本起个名字，颜色用于在列表中快速识别',
    body, footer: foot,
  });

  function submit() {
    const name = input.value.trim();
    if (!name) { toast('请输入名称', 'error'); input.focus(); return; }
    if (book) {
      updateBook(book.id, { name, color: chosen });
      toast('已保存', 'success');
    } else {
      const b = createBook(name, { color: chosen });
      selectBook(b.id);
      toast(`已创建「${name}」`, 'success');
    }
    ref.close();
    render();
  }
}

/* ==================== 顶部 ==================== */

export function renderTopbar() {
  const topbar = $('#topbar');
  topbar.innerHTML = '';
  const book = getBook(vs.bookId);

  const menu = el('button', { class: 'icon-btn only-mobile', id: 'btn-menu', 'aria-label': '打开单词本列表' });
  menu.innerHTML = icon('menu', 20);
  menu.addEventListener('click', openSidebar);
  topbar.appendChild(menu);

  const titleWrap = el('div', { class: 'topbar-title' });
  const heading = el('h1', { class: 'book-heading' });
  heading.append(
    el('span', { class: 'dot', style: `--book-color:${book?.color || '#b8452f'}` }),
    el('span', { text: book?.name || '单词本' })
  );
  const edit = el('button', { class: 'icon-btn', style: 'width:28px;height:28px', title: '重命名' });
  edit.innerHTML = icon('pencil', 14);
  edit.addEventListener('click', () => openBookDialog(book));
  heading.appendChild(edit);
  titleWrap.appendChild(heading);

  const stats = book ? bookStats(book.id) : { count: 0, totalWeight: 0, maxWeight: 0 };
  const meta = el('div', { class: 'book-meta' });
  meta.append(
    el('span', {}, el('b', { text: String(stats.count) }), ' 个词'),
    el('span', {}, '总权重 ', el('b', { text: String(stats.totalWeight) })),
    el('span', {}, '最高 ', el('b', { text: String(stats.maxWeight) }))
  );
  titleWrap.appendChild(meta);
  topbar.appendChild(titleWrap);

  const actions = el('div', { class: 'topbar-actions' });

  const seg = el('div', { class: 'segmented', role: 'tablist' });
  const mkTab = (key, label, iconName) => {
    const b = el('button', {
      class: vs.view === key ? 'active' : '',
      role: 'tab',
      'aria-selected': String(vs.view === key),
    });
    b.innerHTML = icon(iconName, 15) + `<span>${label}</span>`;
    b.addEventListener('click', () => { vs.view = key; render(); });
    return b;
  };
  seg.append(mkTab('list', '列表', 'list'), mkTab('cloud', '词云', 'graph'));
  actions.appendChild(seg);

  const addBtn = el('button', { class: 'btn btn-primary' });
  addBtn.innerHTML = icon('plus', 16) + '<span>添加单词</span>';
  addBtn.addEventListener('click', () => openAddWordDialog({ preselectBookId: vs.bookId }));
  actions.appendChild(addBtn);

  topbar.appendChild(actions);
}

/* ==================== 工具栏 ==================== */

/** 批量补齐：对缺少音标/义项的单词重新查询一次 */
async function fillMissing(bookId, btn) {
  const targets = getEntriesOfBook(bookId)
    .map((x) => x.word)
    .filter((w) => w && missingInfo(w).length);
  if (!targets.length) { toast('没有需要补全的单词', 'default'); return; }
  const original = btn.innerHTML;
  btn.disabled = true;
  let filled = 0;
  for (let i = 0; i < targets.length; i++) {
    const w = targets[i];
    btn.innerHTML = icon('refresh', 14) + `<span>补全中 ${i + 1}/${targets.length}</span>`;
    try {
      const data = await enrichTerm(w.term, { aiClient: aiClientFor(), useDictApi: true, force: true });
      const patch = {
        phonetic: data.phonetic || w.phonetic,
        audio: data.audio || w.audio,
        pos: data.pos?.length ? data.pos : w.pos,
        senses: data.senses?.length ? data.senses : w.senses,
        meaningZh: data.meaningZh || w.meaningZh,
        autoSig: data.senses?.length ? sensesSig(data.senses) : w.autoSig,
        enrichState: data.enrichState,
      };
      if (patch.senses?.length || patch.phonetic) { updateWord(w.id, patch); filled++; }
    } catch (e) {
      console.warn('[fill]', w.term, e);
    }
    await new Promise((r) => setTimeout(r, 420));
  }
  btn.disabled = false;
  btn.innerHTML = original;
  renderAfterDataChange();
  toast(
    filled ? `已补全 ${filled} 个单词` : '词典暂时查不到，稍后再试或手动填写释义',
    filled ? 'success' : 'default',
    3200
  );
}

/* 全部重新获取：把本单词本所有单词重新查一遍词典 */
const NL = String.fromCharCode(10);
let refetchState = { running: false, cancel: false, done: 0, total: 0, bookId: null };
let syncRefetchButton = () => {};

/** 勾选「要覆盖哪些手动编辑过的单词」，返回选中的 id 集合；取消返回 null */
function pickManualWords(words, headline) {
  return new Promise((resolve) => {
    const picked = new Set(words.map((w) => w.id));
    const list = el('div', { class: 'ov-list' });
    const countEl = el('span', { class: 'ov-count' });
    const allBtn = el('button', { class: 'btn btn-quiet btn-sm', text: '全选' });
    const noneBtn = el('button', { class: 'btn btn-quiet btn-sm', text: '清空' });

    const paint = () => {
      countEl.textContent = `已选 ${picked.size} / ${words.length}`;
      for (const row of list.querySelectorAll('.ov-row')) {
        row.classList.toggle('on', picked.has(row.dataset.id));
        const box = row.querySelector('.ov-box');
        if (box) box.checked = picked.has(row.dataset.id);
      }
      allBtn.disabled = picked.size === words.length;
      noneBtn.disabled = picked.size === 0;
    };

    for (const w of words) {
      const box = el('input', { class: 'ov-box', type: 'checkbox' });
      box.checked = true;
      const row = el('label', { class: 'ov-row on', 'data-id': w.id }, [
        box,
        el('span', { class: 'ov-term', text: w.term }),
        el('span', {
          class: 'ov-zh',
          text: String(w.meaningZh || '').split('；').filter(Boolean).slice(0, 2).join('；') || '（没填中文）',
        }),
      ]);
      box.addEventListener('change', () => {
        if (box.checked) picked.add(w.id);
        else picked.delete(w.id);
        paint();
      });
      list.appendChild(row);
    }

    allBtn.addEventListener('click', () => {
      for (const w of words) picked.add(w.id);
      paint();
    });
    noneBtn.addEventListener('click', () => {
      picked.clear();
      paint();
    });

    const body = el('div', {}, [
      el('p', { class: 'ov-tip', text: headline }),
      el('div', { class: 'ov-head' }, [allBtn, noneBtn, countEl]),
      list,
      el('p', { class: 'ov-note', text: '没勾选的单词会保留你手动编辑的释义，只更新音标和发音。' }),
    ]);

    const cancel = el('button', { class: 'btn btn-quiet', text: '返回' });
    const ok = el('button', { class: 'btn btn-primary', text: '确定' });
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      ref.close();
      resolve(val);
    };
    cancel.addEventListener('click', () => done(null));
    ok.addEventListener('click', () => {
      if (!picked.size) { toast('至少选一个单词', 'default'); return; }
      ok.textContent = '确定';
      done(new Set(picked));
    });

    const ref = openModal({
      title: '选择要覆盖的单词',
      subtitle: '这些单词的释义被你手动改过，重新获取会覆盖它们',
      body,
      footer: el('div', { style: 'display:flex;gap:8px;margin-left:auto' }, [cancel, ok]),
      onClose: () => done(null),
    });
    paint();
  });
}

/** 重新获取前先问：要不要覆盖手动编辑，选「覆盖」再勾选具体单词 */
async function askRefetch(scope, bookId, words) {
  const book = getBook(bookId);
  const manual = words.filter((w) => w.sensesManual);
  const lines = [
    scope === 'book'
      ? `将重新查询「${book ? book.name : '当前单词本'}」里全部 ${words.length} 个单词的音标、发音、词性和中文释义。`
      : `将重新查询「${words[0] ? words[0].term : ''}」的音标、发音、词性和中文释义。`,
    '',
    '· 词典接口有限速，会逐个查询，大约几十秒到几分钟；',
  ];
  if (scope === 'book') lines.push('· 查询过程中单词会一个个更新，可以随时点「取消」停下；');
  lines.push('· 查不到的词保留原来的内容，不会变空；');
  lines.push(
    manual.length
      ? `· 其中 ${manual.length} 个单词你手动编辑过释义，默认保留；`
      : '· 手动改过的中文释义会被新查到的结果覆盖。',
  );

  return new Promise((resolve) => {
    const cover = el('input', { class: 'ov-box', type: 'checkbox' });
    const coverRow = el('label', { class: 'ov-cover' }, [
      cover,
      el('span', {
        text: manual.length
          ? `覆盖手动编辑过的 ${manual.length} 个单词（勾选后可挑选具体是哪几个）`
          : '覆盖手动编辑过的单词（当前没有）',
      }),
    ]);
    if (!manual.length) { cover.disabled = true; coverRow.style.opacity = '.5'; }

    const body = el('div', {}, [
      el('p', { style: 'white-space:pre-line;line-height:1.9', text: lines.join(NL) }),
      manual.length ? coverRow : null,
    ]);

    const cancel = el('button', { class: 'btn btn-quiet', text: '取消' });
    const start = el('button', { class: 'btn btn-primary', text: '开始重新获取' });
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      ref.close();
      resolve(val);
    };
    cancel.addEventListener('click', () => finish({ started: false, overwrite: new Set() }));
    start.addEventListener('click', async () => {
      if (!cover.checked || !manual.length) { finish({ started: true, overwrite: new Set() }); return; }
      if (settled) return;
      settled = true;
      ref.close(); // 先收起提示框，避免两层遮罩叠在一起
      const picked = await pickManualWords(
        manual,
        `本单词本有 ${manual.length} 个单词被手动编辑过，勾选要重新抓取并覆盖的：`,
      );
      resolve(picked ? { started: true, overwrite: picked } : { started: false, overwrite: new Set() });
    });

    const ref = openModal({
      title: scope === 'book' ? '全部重新获取' : '重新获取',
      body,
      footer: el('div', { style: 'display:flex;gap:8px;margin-left:auto' }, [cancel, start]),
      onClose: () => finish({ started: false, overwrite: new Set() }),
    });
  });
}

async function refetchAll(bookId) {
  if (refetchState.running) { refetchState.cancel = true; return; }
  const words = getEntriesOfBook(bookId).map((x) => x.word).filter(Boolean);
  if (!words.length) { toast('这个单词本还没有单词', 'default'); return; }
  const asked = await askRefetch('book', bookId, words);
  if (!asked.started) return;
  const overwrite = asked.overwrite;

  refetchState = { running: true, cancel: false, done: 0, total: words.length, bookId };
  syncRefetchButton();
  let updated = 0;
  let failed = 0;
  let kept = 0;
  let rateStop = false;

  for (const w of words) {
    if (refetchState.cancel) break;
    try {
      const data = await enrichTerm(w.term, { aiClient: aiClientFor(), useDictApi: true, force: true });
      // 手动编辑过、又没被勾选覆盖的词：只更新音标和发音
      const protect = w.sensesManual && !overwrite.has(w.id);
      const patch = {};
      if (data.phonetic) patch.phonetic = data.phonetic;
      if (data.audio) patch.audio = data.audio;
      if (protect) {
        kept++;
        patch.enrichState = w.enrichState || 'done';
      } else {
        if (data.pos?.length) patch.pos = data.pos;
        if (data.senses?.length) { patch.senses = data.senses; patch.autoSig = sensesSig(data.senses); }
        if (data.meaningZh) patch.meaningZh = data.meaningZh;
        if (w.sensesManual) patch.sensesManual = false;
        patch.enrichState = data.enrichState || 'done';
      }
      if (Object.keys(patch).length > 1) { updateWord(w.id, patch); updated++; }
      else failed++;
      // 翻译接口限流时别硬撑：剩下的改天再来，否则会把一批词的中文洗成空的
      if (!patch.meaningZh && wasRateLimited()) { rateStop = true; }
    } catch (e) {
      console.warn('[refetch]', w.term, e);
      failed++;
    }
    refetchState.done++;
    if (refetchState.bookId === vs.bookId && vs.view === 'list') renderListOnly();
    syncRefetchButton();
    if (rateStop) break;
    await new Promise((r) => setTimeout(r, 420));
  }

  const cancelled = refetchState.cancel;
  refetchState.running = false;
  renderAfterDataChange();
  let msg;
  const keptNote = kept ? `，${kept} 个保留了你手动编辑的释义` : '';
  if (rateStop) msg = `翻译接口限流，先更新了 ${updated} 个单词${keptNote}，剩下的稍后再试`;
  else if (cancelled) msg = `已停止，更新了 ${updated} 个单词${keptNote}`;
  else if (failed) msg = `已更新 ${updated} 个单词${keptNote}，${failed} 个没查到（保留原内容）`;
  else msg = `已更新 ${updated} 个单词${keptNote}`;
  toast(msg, updated ? 'success' : 'default', 3600);
}

let syncFillButton = () => {};

export function renderToolbar() {
  const bar = $('#toolbar');
  bar.innerHTML = '';
  if (vs.view !== 'list') { bar.style.display = 'none'; return; }
  bar.style.display = '';

  const searchWrap = el('div', { class: 'search-box' });
  searchWrap.innerHTML = icon('search', 16);
  const input = el('input', {
    id: 'search-input', type: 'search', placeholder: '搜索单词或释义…',
    value: vs.query, autocomplete: 'off',
  });
  input.addEventListener('input', () => {
    vs.query = input.value;
    renderListOnly();
  });
  searchWrap.appendChild(input);
  bar.appendChild(searchWrap);

  const select = el('select', { class: 'sort-select', id: 'sort-select' });
  const opts = [
    ['weight-desc', '权重：高 → 低'],
    ['weight-asc', '权重：低 → 高'],
    ['time-desc', '加入时间：新 → 旧'],
    ['time-asc', '加入时间：旧 → 新'],
  ];
  for (const [v, label] of opts) {
    const o = el('option', { value: v, text: label });
    if (vs.sort === v) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => { vs.sort = select.value; renderListOnly(); });
  bar.appendChild(select);

  bar.appendChild(el('div', { class: 'spacer' }));

  const fillHost = el('span', { id: 'fill-host' });
  bar.appendChild(fillHost);
  syncFillButton = () => paintFillButton();
  paintFillButton();

  const refetchHost = el('span', { id: 'refetch-host' });
  bar.appendChild(refetchHost);
  syncRefetchButton = () => paintRefetchButton();
  paintRefetchButton();

  const count = el('span', { class: 'result-count', id: 'result-count' });
  bar.appendChild(count);
  updateCount();

  function paintFillButton() {
    fillHost.innerHTML = '';
    if (!fillHost.isConnected) return;
    const gaps = getEntriesOfBook(vs.bookId)
      .map((x) => x.word)
      .filter((w) => w && missingInfo(w).length);
    if (!gaps.length) return;
    const fillBtn = el('button', { class: 'btn btn-quiet btn-sm', id: 'btn-fill' });
    fillBtn.innerHTML = icon('refresh', 14) + `<span>补全释义 ${gaps.length}</span>`;
    fillBtn.title = '为缺少音标或释义的单词重新查询词典';
    fillBtn.addEventListener('click', () => fillMissing(vs.bookId, fillBtn));
    fillHost.appendChild(fillBtn);
  }

  function paintRefetchButton() {
    refetchHost.innerHTML = '';
    if (!refetchHost.isConnected) return;
    if (!getEntriesOfBook(vs.bookId).length) return;
    const mine = refetchState.running && refetchState.bookId === vs.bookId;
    const btn = el('button', { class: 'btn btn-quiet btn-sm', id: 'btn-refetch' });
    if (mine) {
      btn.innerHTML = icon('x', 14) + `<span>取消 · ${refetchState.done}/${refetchState.total}</span>`;
      btn.title = '点击停止本次重新获取';
      btn.addEventListener('click', () => { refetchState.cancel = true; paintRefetchButton(); });
    } else if (refetchState.running) {
      btn.disabled = true;
      btn.innerHTML = `<span>正在刷新另一个单词本…</span>`;
    } else {
      btn.innerHTML = icon('refresh', 14) + '<span>全部重新获取</span>';
      btn.title = '对本单词本的每个单词重新查询词典（音标、发音、词性、多义项释义）';
      btn.addEventListener('click', () => refetchAll(vs.bookId));
    }
    refetchHost.appendChild(btn);
  }
}

function updateCount() {
  const c = $('#result-count');
  if (!c) return;
  const total = getEntriesOfBook(vs.bookId).length;
  const shown = listData().length;
  c.textContent = vs.query.trim() ? `筛选出 ${shown} / ${total}` : `共 ${total} 个词条`;
}

/* ==================== 列表 ==================== */

function listData() {
  let items = getEntriesOfBook(vs.bookId);
  const q = vs.query.trim().toLowerCase();
  if (q) {
    items = items.filter(({ word }) =>
      word.term.toLowerCase().includes(q) ||
      (word.meaningZh || '').toLowerCase().includes(q) ||
      (word.pos || []).some((p) => String(p.tag).toLowerCase().includes(q))
    );
  }
  const cmp = {
    'weight-desc': (a, b) => b.entry.weight - a.entry.weight || b.entry.firstAddedAt - a.entry.firstAddedAt,
    'weight-asc': (a, b) => a.entry.weight - b.entry.weight || a.entry.firstAddedAt - b.entry.firstAddedAt,
    'time-desc': (a, b) => b.entry.firstAddedAt - a.entry.firstAddedAt,
    'time-asc': (a, b) => a.entry.firstAddedAt - b.entry.firstAddedAt,
  }[vs.sort];
  return items.sort(cmp);
}

export function renderListOnly() {
  const host = $('#list-host');
  if (!host) return;
  host.innerHTML = '';
  const items = listData();
  updateCount();
  syncFillButton();
  syncRefetchButton();
  if (!items.length) {
    host.appendChild(vs.query.trim() ? noResultState() : emptyState());
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of items) frag.appendChild(renderRow(item));
  host.appendChild(frag);
}

function renderRow({ entry, word }) {
  const row = el('div', { class: 'word-row', 'data-word': word.id, 'data-entry': entry.id });
  if (vs.highlightId === word.id) {
    row.classList.add('flash');
    setTimeout(() => { vs.highlightId = null; }, 1600);
  }

  const main = el('div', { class: 'word-main' });
  const term = el('span', {
    class: `word-term${word.term.includes(' ') ? ' is-phrase' : ''}`,
    text: word.term,
  });
  main.appendChild(term);
  if (word.phonetic) main.appendChild(el('span', { class: 'phonetic', text: word.phonetic }));

  const speakBtn = el('button', { class: 'speak-btn', title: '发音', 'aria-label': `朗读 ${word.term}` });
  speakBtn.innerHTML = icon('volume', 14);
  speakBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pronounce(word.term, { audio: word.audio, rate: getSettings().ttsRate });
  });
  main.appendChild(speakBtn);

  const body = el('div', { class: 'word-body' });
  const senses = Array.isArray(word.senses) ? word.senses.filter((s) => s && (s.zh || s.def)) : [];
  // 「常见意思」这一行（meaningZh）如果能和词典义项对上，就按词性逐条展示；
  // 对不上（词典数据里只有生僻义，例如 sad 的「吃饱了」）就只展示常见译法，避免把怪意思顶到最前
  const commonParts = String(word.meaningZh || '').split('；').map((x) => x.trim()).filter(Boolean);
  const senseZhList = senses.map((s) => s.zh || '').filter(Boolean);
  const alignedWithSenses = commonParts.some((g) => senseZhList.some((z) => z.includes(g)));
  if (senses.length && (word.sensesManual || alignedWithSenses || !commonParts.length)) {
    // 一个词性一条：词性标签 + 该义项的中文，最多两条；
    // 中文重复的义项（v. 开始 / n. 开始）在列表里只留第一条，免得看着像重复
    // 只挑有中文的义项：没译出来的义项在列表里露英文会很难看，详情里能看到
    const shown = [];
    const seen = new Set();
    for (const s of senses) {
      const zh = s.zh || '';
      if (!zh || seen.has(zh)) continue;
      if (shown.length >= 2) break;
      seen.add(zh);
      shown.push(s);
    }
    const hidden = senses.length - shown.length;
    if (shown.length) {
      for (const s of shown) {
        const line = el('div', { class: 'pos-line sense' });
        const ab = posAbbr(s.pos);
        if (ab) line.appendChild(el('span', { class: `pos-tag ${posClass(ab)}`, text: ab }));
        line.appendChild(el('span', { class: 'meaning-zh', text: s.zh || '' }));
        body.appendChild(line);
      }
      if (hidden > 0) {
        body.appendChild(el('div', { class: 'pos-line more-note', text: `还有 ${hidden} 个义项` }));
      }
    } else {
      // 一条中文都没有（词典查到了、翻译接口却没额度了）：不要拿英文释义糊在列表里
      const line = el('div', { class: 'pos-line' });
      const ab0 = posAbbr(senses[0].pos);
      if (ab0) line.appendChild(el('span', { class: `pos-tag ${posClass(ab0)}`, text: ab0 }));
      line.appendChild(el('span', { class: 'meaning-zh muted', text: '释义待补充' }));
      body.appendChild(line);
    }
  } else {
    const posLine = el('div', { class: 'pos-line' });
    let shown = 0;
    // 有义项时用主词性的标签，否则用词性列表
    const tags = senses.length ? [senses[0].pos] : (word.pos || []).slice(0, 3).map((p) => p.tag);
    for (const tag of tags) {
      const ab = posAbbr(tag);
      if (!ab) continue;
      posLine.appendChild(el('span', { class: `pos-tag ${posClass(ab)}`, text: ab }));
      shown++;
    }
    if (word.meaningZh) {
      posLine.appendChild(el('span', { class: 'meaning-zh', text: word.meaningZh }));
    } else if (shown === 0) {
      posLine.appendChild(el('span', { class: 'meaning-zh muted', text: '释义待补充' }));
    }
    body.appendChild(posLine);
  }

  const side = el('div', { class: 'word-side' });
  const pill = el('span', {
    class: `weight-pill ${weightClass(entry.weight)}`,
    title: `权重 ${entry.weight}（重复录入会累加）`,
  });
  pill.innerHTML = `<span>${entry.weight}</span>`;
  side.appendChild(pill);
  side.appendChild(el('span', { class: 'added-time', text: formatDate(entry.firstAddedAt) }));

  const acts = el('div', { class: 'row-actions' });
  const mkAct = (name, title, fn, danger) => {
    const b = el('button', { title, 'aria-label': title, class: danger ? 'danger' : '' });
    b.innerHTML = icon(name, 15);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  acts.append(
    mkAct('plus', '再记一次（权重 +1）', () => {
      addTerm(word.term, [vs.bookId]);
      vs.highlightId = word.id;
      toast(`「${word.term}」权重 +1`, 'success', 1500);
    }),
    mkAct('trash', '从本单词本移除', async () => {
      if (await confirmDialog({
        title: '移除词条',
        message: `从「${getBook(vs.bookId)?.name}」移除「${word.term}」？该词在其他单词本中的记录不受影响。`,
        confirmText: '移除', danger: true,
      })) { removeEntry(entry.id); toast('已移除'); }
    }, true)
  );
  side.appendChild(acts);

  row.append(main, body, side);
  row.addEventListener('click', () => openWordDetail(word.id, vs.bookId));
  return row;
}

function emptyState() {
  const wrap = el('div', { class: 'empty' });
  const mark = el('div', { class: 'empty-mark' });
  mark.innerHTML = icon('book', 30);
  wrap.appendChild(mark);
  wrap.appendChild(el('h3', { text: '这个单词本还是空的' }));
  wrap.appendChild(el('p', { text: '添加第一个单词吧。输入单词后会自动获取音标、发音、词性和中文释义。' }));
  const btn = el('button', { class: 'btn btn-primary' });
  btn.innerHTML = icon('plus', 16) + '<span>添加单词</span>';
  btn.addEventListener('click', () => openAddWordDialog({ preselectBookId: vs.bookId }));
  wrap.appendChild(btn);
  return wrap;
}

function noResultState() {
  const wrap = el('div', { class: 'empty' });
  const mark = el('div', { class: 'empty-mark' });
  mark.innerHTML = icon('search', 28);
  wrap.appendChild(mark);
  wrap.appendChild(el('h3', { text: '没有匹配的单词' }));
  wrap.appendChild(el('p', { text: `「${vs.query}」在本单词本中没有找到。可以清空搜索继续浏览。` }));
  const btn = el('button', { class: 'btn btn-quiet', text: '清空搜索' });
  btn.addEventListener('click', () => {
    vs.query = '';
    const input = $('#search-input');
    if (input) input.value = '';
    renderListOnly();
  });
  wrap.appendChild(btn);
  return wrap;
}

/* ==================== 单词详情 ==================== */

function aiClientFor() {
  return hasAI() ? { translateWord, translateSenses, describeWord } : null;
}

if (DEMO_MODE) {
  // 调试入口：?demo 下可从控制台直接打开某个词的详情
  window.__vnOpenWord = (term) => {
    const w = getWordByTerm(term);
    if (w) openWordDetail(w.id, vs.bookId);
    return w ? w.id : null;
  };
}

export function openWordDetail(wordId, bookId) {
  const word = getWord(wordId);
  if (!word) return;
  const entry = getEntry(bookId, wordId);

  const body = el('div', {});

  const head = el('div', { class: 'preview-card', style: 'margin-bottom:18px' });
  const headTop = el('div', { class: 'preview-head' });
  headTop.append(
    el('span', { class: 'preview-term', text: word.term }),
    el('span', { class: 'preview-phonetic', text: word.phonetic || '' })
  );
  const sp = el('button', { class: 'speak-btn', title: '发音' });
  sp.innerHTML = icon('volume', 15);
  sp.addEventListener('click', () => {
    pronounce(word.term, { audio: word.audio, rate: getSettings().ttsRate });
  });
  headTop.appendChild(sp);
  head.appendChild(headTop);

  // 释义卡片：词性和中文都能直接改，拖动左侧手柄调整顺序（列表里取前两条）
  const senseList = el('div', { class: 'se-list' });
  const seed = (Array.isArray(word.senses) ? word.senses : []).filter((s) => s && (s.zh || s.def));
  if (!seed.length && word.meaningZh) {
    seed.push({ pos: word.pos?.[0]?.tag || '', zh: word.meaningZh, def: '' });
  }
  // 「到底改没改」的基准：优先用词典/AI 最近一次给出的原始顺序（autoSig），
  // 老数据没有 autoSig 时退回「打开弹窗时的内容」。
  const seedSig = word.autoSig || sensesSig(seed);

  // 整张卡片都能拖（输入框、按钮除外）：拖动时卡片「浮」起来跟着指针走，原位留一个占位
  function attachDrag(card) {
    card.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      if (e.target.closest('input, button, select, textarea')) return;
      e.preventDefault();
      const rect = card.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const addBtn = senseList.querySelector('.se-add');
      let ghost = null;
      let moving = false;

      const onMove = (ev) => {
        const dy = ev.clientY - startY;
        if (!moving) {
          if (Math.abs(dy) < 4) return;
          moving = true;
          ghost = el('div', { class: 'se-ghost' });
          ghost.style.height = `${rect.height}px`;
          senseList.insertBefore(ghost, card);
          // 先占位再脱离文档流，其它卡片不会跳；坐标相对 .se-list
          const listRect = senseList.getBoundingClientRect();
          card.classList.add('dragging');
          card.style.position = 'absolute';
          card.style.width = `${rect.width}px`;
          card.style.height = `${rect.height}px`;
          card.style.left = `${rect.left - listRect.left}px`;
          card.style.top = `${rect.top - listRect.top}px`;
        }
        card.style.transform = `translate(${ev.clientX - startX}px, ${dy}px) scale(1.015)`;
        // 跟着指针的中心去和别的卡片比位置，实时挪动占位块
        const centerY = rect.top + dy + rect.height / 2;
        const others = Array.from(senseList.querySelectorAll('.se-card:not(.se-add)')).filter((c) => c !== card);
        let placed = false;
        for (const c of others) {
          const r = c.getBoundingClientRect();
          if (centerY < r.top + r.height / 2) {
            if (ghost.nextElementSibling !== c) senseList.insertBefore(ghost, c);
            placed = true;
            break;
          }
        }
        if (!placed && addBtn && ghost.nextElementSibling !== addBtn) senseList.insertBefore(ghost, addBtn);
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (!moving) { card.style.cssText = ''; return; }

        // FLIP：记下「浮着」时的位置，落位后从这个位置滑回虚框，动画更顺
        const fromRect = card.getBoundingClientRect();
        card.classList.remove('dragging');
        card.style.cssText = '';
        if (ghost && ghost.parentNode) {
          ghost.parentNode.insertBefore(card, ghost);
          ghost.remove();
        }
        paintTags();
        const toRect = card.getBoundingClientRect();
        const dx = fromRect.left - toRect.left;
        const dy = fromRect.top - toRect.top;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduce && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
          card.style.zIndex = '40';
          card.style.transition = 'none';
          card.style.transform = `translate(${dx}px, ${dy}px) scale(1.015)`;
          card.style.boxShadow = '0 16px 32px -14px rgba(32, 29, 25, .4)';
          void card.offsetHeight; // 先让起始位置生效，再开始过渡
          setTimeout(() => {
            const done = () => {
              card.style.transition = '';
              card.style.transform = '';
              card.style.boxShadow = '';
              card.style.zIndex = '';
              card.removeEventListener('transitionend', done);
            };
            card.style.transition = 'transform .19s cubic-bezier(.2, .85, .3, 1), box-shadow .19s ease';
            card.style.transform = '';
            card.style.boxShadow = '';
            card.addEventListener('transitionend', done);
            setTimeout(done, 340);
          }, 16);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  function paintTags() {
    const list = Array.from(senseList.querySelectorAll('.se-card'));
    const firstZh = list[0]?.querySelector('.se-zh')?.value.trim() || '';
    list.forEach((card, i) => {
      const tag = card.querySelector('.se-tag');
      if (!tag) return;
      const zh = card.querySelector('.se-zh').value.trim();
      // 只对「词典抓来的」义项判冷僻；用户自己补的义项不判
      const cold = i > 0 && !!firstZh && !!zh && !!card.dataset.def && zhOverlap(zh, firstZh) < 0.5;
      card.classList.toggle('cold', cold);
      if (i === 0) { tag.textContent = '常用'; tag.classList.remove('hide'); }
      else if (cold) { tag.textContent = '冷僻'; tag.classList.remove('hide'); }
      else tag.classList.add('hide');
    });
  }

  function makeCard(src) {
    const card = el('div', { class: 'se-card' });
    card.dataset.def = src.def || '';
    card.dataset.eg = src.example || '';
    const handle = el('span', { class: 'se-handle', title: '按住拖动可以调整顺序' });
    handle.innerHTML = icon('menu', 15);
    const main = el('div', { class: 'se-main' });
    const line = el('div', { class: 'se-line' });
    const posIn = el('input', { class: 'se-pos', type: 'text', placeholder: '词性', autocomplete: 'off' });
    posIn.value = src.pos ? posAbbr(src.pos) : '';
    const zhIn = el('input', { class: 'se-zh', type: 'text', placeholder: '中文释义', autocomplete: 'off' });
    zhIn.value = src.zh || '';
    const tag = el('span', { class: 'se-tag hide', text: '常用' });
    const delBtn = el('button', { class: 'se-del', title: '删除这条释义', type: 'button' });
    delBtn.innerHTML = icon('x', 13);
    line.append(posIn, zhIn, tag, delBtn);
    main.appendChild(line);
    if (src.def) main.appendChild(el('div', { class: 'se-def', text: src.def }));
    if (src.example) main.appendChild(el('div', { class: 'se-eg', text: `e.g. ${src.example}` }));
    card.append(handle, main);
    delBtn.addEventListener('click', () => { card.remove(); paintTags(); });
    attachDrag(card);
    return card;
  }

  const addCard = el('button', { class: 'se-card se-add', type: 'button' });
  addCard.innerHTML = icon('plus', 14) + '<span>添加释义</span>';
  addCard.addEventListener('click', () => {
    const card = makeCard({ pos: '', zh: '', def: '' });
    senseList.insertBefore(card, addCard);
    paintTags();
    card.querySelector('.se-pos').focus();
  });

  seed.forEach((s) => senseList.appendChild(makeCard(s)));
  senseList.appendChild(addCard);
  senseList.appendChild(
    el('p', {
      class: 'se-hint',
      text: window.matchMedia('(pointer: coarse)').matches
        ? '按住左侧手柄上下拖可以调整顺序；列表里只显示前两条。'
        : '按住卡片上下拖可以调整顺序（输入框除外）；列表里只显示前两条。',
    }),
  );
  senseList.addEventListener('input', () => paintTags());
  head.appendChild(senseList);
  paintTags();
  body.appendChild(head);

  // 权重
  const weightField = el('div', { class: 'field' });
  weightField.appendChild(el('div', { class: 'field-label' }, el('span', { text: '权重' })));
  const wRow = el('div', { style: 'display:flex;align-items:center;gap:12px' });
  const pill = el('span', { class: `weight-pill ${weightClass(entry?.weight || 1)}`, style: 'font-size:15px;padding:6px 13px' });
  const paintPill = () => {
    pill.className = `weight-pill ${weightClass(entry?.weight || 1)}`;
    pill.innerHTML = icon('weight', 13) + `<span>${entry?.weight || 0}</span>`;
  };
  paintPill();
  const minus = el('button', { class: 'btn btn-quiet', text: '−1', style: 'padding:6px 12px' });
  const plus = el('button', { class: 'btn btn-quiet', text: '+1', style: 'padding:6px 12px' });
  minus.addEventListener('click', () => { if (entry) { adjustWeight(entry.id, -1); paintPill(); render(); } });
  plus.addEventListener('click', () => { if (entry) { adjustWeight(entry.id, 1); paintPill(); render(); } });
  wRow.append(minus, pill, plus);
  weightField.appendChild(wRow);
  weightField.appendChild(el('div', { class: 'field-hint', text: '首次加入为 1，同一单词重复加入同一单词本时 +1。' }));
  body.appendChild(weightField);

  // 所在单词本
  const booksField = el('div', { class: 'field' });
  booksField.appendChild(el('div', { class: 'field-label' }, el('span', { text: '所在单词本' })));
  const chips = el('div', { class: 'book-chips' });
  for (const { book, entry: e } of getBooksOfWord(wordId)) {
    const chip = el('span', {
      class: 'book-chip on',
      style: `--chip-color:${book.color};--chip-bg:${book.color}1a`,
    });
    chip.append(el('span', { text: `${book.name} · ${e.weight}` }));
    const rm = el('button', { title: '移除', style: 'margin-left:2px;color:var(--ink-3);display:grid;place-items:center' });
    rm.innerHTML = icon('x', 12);
    rm.addEventListener('click', () => {
      if (e.bookId === bookId) { toast('不能从当前单词本移除，请用列表上的移除按钮', 'error'); return; }
      removeEntry(e.id);
      openWordDetail(wordId, bookId);
      render();
    });
    chip.appendChild(rm);
    chips.appendChild(chip);
  }
  booksField.appendChild(chips);
  body.appendChild(booksField);

  // 关联关系
  const links = getLinks(bookId).filter((l) => l.a === wordId || l.b === wordId);
  if (links.length) {
    const relField = el('div', { class: 'field' });
    relField.appendChild(el('div', { class: 'field-label' }, el('span', { text: '单词关系' })));
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    for (const l of links) {
      const otherId = l.a === wordId ? l.b : l.a;
      const other = getWord(otherId);
      if (!other) continue;
      const rowEl = el('div', {
        style: 'display:flex;align-items:center;gap:9px;padding:7px 10px;border:1px solid var(--line);border-radius:9px;font-size:13px',
      });
      const dot = el('span', {
        style: `width:8px;height:8px;border-radius:3px;background:${REL_TYPES[l.type]?.color || '#999'};flex:none`,
      });
      rowEl.append(dot, el('span', { text: REL_TYPES[l.type]?.label || '关联' }),
        el('span', { text: '·', style: 'color:var(--ink-4)' }),
        el('span', { text: other.term, style: 'font-family:var(--serif);font-weight:600' }));
      const del = el('button', { style: 'margin-left:auto;color:var(--ink-3)' });
      del.innerHTML = icon('x', 13);
      del.addEventListener('click', () => { removeLink(l.id); openWordDetail(wordId, bookId); });
      rowEl.appendChild(del);
      list.appendChild(rowEl);
    }
    relField.appendChild(list);
    body.appendChild(relField);
  }

  const foot = el('div', { style: 'display:flex;gap:9px;width:100%' });
  const del = el('button', { class: 'btn btn-quiet', style: 'color:var(--accent)' });
  del.innerHTML = icon('trash', 15) + '<span>从本单词本移除</span>';
  del.addEventListener('click', async () => {
    if (!entry) return;
    if (await confirmDialog({ title: '移除词条', message: `从「${getBook(bookId)?.name}」移除「${word.term}」？`, confirmText: '移除', danger: true })) {
      removeEntry(entry.id); ref.close(); render(); toast('已移除');
    }
  });
  const refreshBtn = el('button', { class: 'btn btn-quiet', style: 'margin-left:auto' });
  refreshBtn.innerHTML = icon('refresh', 15) + '<span>重新获取</span>';
  refreshBtn.title = '重新查一次词典，补齐音标、词性与多个义项';
  refreshBtn.addEventListener('click', async () => {
    const asked = await askRefetch('word', bookId, [word]);
    if (!asked.started) return;
    const protect = !!word.sensesManual && !asked.overwrite.has(word.id);
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = icon('refresh', 15) + '<span>获取中…</span>';
    try {
      const data = await enrichTerm(word.term, { aiClient: aiClientFor(), useDictApi: true, force: true });
      const patch = {
        phonetic: data.phonetic || word.phonetic,
        audio: data.audio || word.audio,
        enrichState: data.enrichState || word.enrichState,
      };
      if (protect) {
        patch.pos = word.pos;
        patch.senses = word.senses;
        patch.meaningZh = word.meaningZh;
        patch.sensesManual = true;
      } else {
        patch.pos = data.pos?.length ? data.pos : word.pos;
        patch.senses = data.senses?.length ? data.senses : word.senses;
        patch.meaningZh = data.meaningZh || word.meaningZh;
        patch.sensesManual = false;
        patch.autoSig = sensesSig(patch.senses || []);
      }
      updateWord(wordId, patch);
      ref.close();
      render();
      if (protect) toast('已更新音标与发音，保留了你手动编辑的释义', 'success', 3000);
      else if (patch.senses?.length) toast(`已补全 ${patch.senses.length} 个义项`, 'success');
      else toast('词典没有查到，稍后再试或手动填写释义', 'default', 3000);
      openWordDetail(wordId, bookId);
    } catch (e) {
      toast(`获取失败：${String(e.message || e).slice(0, 40)}`, 'error', 3000);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = icon('refresh', 15) + '<span>重新获取</span>';
    }
  });
  const save = el('button', { class: 'btn btn-primary', text: '保存修改', style: 'margin-left:auto' });
  save.addEventListener('click', () => {
    const out = Array.from(senseList.querySelectorAll('.se-card'))
      .filter((c) => !c.classList.contains('se-add'))
      .map((c) => ({
        pos: posTag(c.querySelector('.se-pos').value),
        zh: c.querySelector('.se-zh').value.trim(),
        def: c.dataset.def || '',
        example: c.dataset.eg || '',
      }))
      .filter((s) => s.zh || s.pos);
    const meaningZh = out.map((s) => s.zh).filter(Boolean).slice(0, 4).join('；');
    const tags = Array.from(new Set(out.map((s) => s.pos).filter(Boolean)));
    // 加了又删、拖乱了又拖回原样 → 与词典给的原顺序一致，就不算手动编辑。
    // 有 autoSig（词典/AI 给的原始顺序）时完全按内容判断；老数据没有基线，只增不减。
    const changed = sensesSig(out) !== seedSig;
    updateWord(wordId, {
      senses: out,
      meaningZh,
      pos: tags.length ? tags.map((t) => ({ tag: t })) : word.pos,
      sensesManual: word.autoSig ? changed : (changed || !!word.sensesManual),
      enrichState: out.length ? 'done' : word.enrichState,
    });
    toast('已保存', 'success');
    ref.close();
    render();
  });
  foot.append(del, refreshBtn, save);

  const ref = openModal({
    title: word.term,
    subtitle: `加入于 ${formatDate(entry?.firstAddedAt || word.createdAt)}`,
    body, footer: foot, wide: true,
  });
}

/* ==================== 设置 ==================== */

function openPasteImport() {
  const ta = el('textarea', {
    class: 'xfer-code',
    rows: '6',
    placeholder: '把备份内容整段粘贴到这里（以 { 开头）',
  });
  const ok = el('button', { class: 'btn btn-primary', text: '导入' });
  const cancel = el('button', { class: 'btn btn-quiet', text: '取消' });
  const m = openModal({
    title: '粘贴导入',
    subtitle: '与「导出备份」「复制备份」的内容格式相同',
    body: ta,
    footer: el('div', { style: 'display:flex;gap:8px;margin-left:auto' }, [cancel, ok]),
  });
  cancel.addEventListener('click', () => m.close());
  ok.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) { toast('先粘贴内容', 'error'); return; }
    try {
      importJSON(text, 'merge');
      m.close();
      toast('导入完成', 'success');
      render();
    } catch (e) {
      toast(`导入失败：${e.message}`, 'error');
    }
  });
}

export function openSettingsDialog() {
  const s = getSettings();
  const body = el('div', {});

  /* AI */
  const aiSec = el('div', { class: 'settings-section' });
  aiSec.appendChild(el('h3', { text: 'AI 服务' }));
  aiSec.appendChild(el('p', { text: '用于智能分类、中文释义和词团关系生成。支持 DeepSeek、OpenAI 及任何兼容 OpenAI 格式的接口。' }));

  const providerSel = el('select', { class: 'text-input', style: 'margin-bottom:12px' });
  for (const [k, v] of Object.entries(PROVIDERS)) {
    const o = el('option', { value: k, text: v.label });
    if (s.aiProvider === k) o.selected = true;
    providerSel.appendChild(o);
  }
  aiSec.appendChild(providerSel);

  const baseInput = el('input', { class: 'text-input', placeholder: '接口地址，如 https://api.deepseek.com/v1', value: s.aiBaseUrl });
  const modelInput = el('input', { class: 'text-input', placeholder: '模型名，如 deepseek-chat', value: s.aiModel, style: 'margin-top:10px' });
  const keyInput = el('input', { class: 'text-input', type: 'password', placeholder: 'API Key（只保存在本机）', value: s.aiKey, style: 'margin-top:10px' });
  aiSec.append(baseInput, modelInput, keyInput);

  providerSel.addEventListener('change', () => {
    const p = PROVIDERS[providerSel.value];
    baseInput.value = p.baseUrl;
    modelInput.value = p.model;
  });

  const testRow = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-top:12px' });
  const testBtn = el('button', { class: 'btn btn-quiet' });
  testBtn.innerHTML = icon('refresh', 15) + '<span>测试连接</span>';
  const testResult = el('span', { style: 'font-size:12.5px;color:var(--ink-3)' });
  testBtn.addEventListener('click', async () => {
    updateSettings({ aiProvider: providerSel.value, aiBaseUrl: baseInput.value.trim(), aiModel: modelInput.value.trim(), aiKey: keyInput.value.trim() });
    testBtn.disabled = true;
    testResult.textContent = '测试中…';
    try {
      const r = await testConnection();
      testResult.style.color = 'var(--green)';
      testResult.textContent = `连接正常（${r.slice(0, 12)}）`;
    } catch (e) {
      testResult.style.color = 'var(--accent)';
      testResult.textContent = String(e.message || e).slice(0, 60);
    } finally { testBtn.disabled = false; }
  });
  testRow.append(testBtn, testResult);
  aiSec.appendChild(testRow);
  body.appendChild(aiSec);

  /* 词典 */
  const dictSec = el('div', { class: 'settings-section' });
  dictSec.appendChild(el('h3', { text: '词典与发音' }));
  dictSec.appendChild(el('p', { text: '开启后，录入单词时自动从 Free Dictionary API 获取音标、词性与英文释义。' }));

  const enrichRow = el('div', { class: 'setting-row' });
  const enrichSwitch = el('button', { class: `switch${s.autoEnrich ? ' on' : ''}`, 'aria-label': '自动获取单词信息' });
  enrichSwitch.addEventListener('click', () => {
    enrichSwitch.classList.toggle('on');
    updateSettings({ autoEnrich: enrichSwitch.classList.contains('on') });
  });
  enrichRow.append(
    el('div', { class: 'label' }, el('span', { text: '录入时自动获取词典信息' }), el('small', { text: '关闭后需手动填写释义' })),
    enrichSwitch
  );
  dictSec.appendChild(enrichRow);

  const rateRow = el('div', { class: 'setting-row' });
  const rate = el('input', { type: 'range', min: '0.5', max: '1.4', step: '0.1', value: String(s.ttsRate), style: 'width:140px' });
  const rateVal = el('span', { style: 'font-size:12.5px;color:var(--ink-3);width:34px', text: `${s.ttsRate}×` });
  rate.addEventListener('input', () => { rateVal.textContent = `${rate.value}×`; updateSettings({ ttsRate: Number(rate.value) }); });
  rateRow.append(el('div', { class: 'label' }, el('span', { text: '朗读速度' })), rate, rateVal);
  dictSec.appendChild(rateRow);
  body.appendChild(dictSec);

  /* 数据 */
  const dataSec = el('div', { class: 'settings-section' });
  dataSec.appendChild(el('h3', { text: '数据' }));
  dataSec.appendChild(el('p', { text: '所有数据默认保存在本机浏览器中。建议定期导出备份。' }));

  const dataRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
  const expBtn = el('button', { class: 'btn btn-quiet' });
  expBtn.innerHTML = icon('download', 15) + '<span>导出备份</span>';
  expBtn.addEventListener('click', () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `拾词备份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('已导出', 'success');
  });

  const impBtn = el('button', { class: 'btn btn-quiet' });
  impBtn.innerHTML = icon('upload', 15) + '<span>导入备份</span>';
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  impBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      importJSON(text, 'merge');
      toast('导入完成', 'success');
      render();
    } catch (e) { toast(`导入失败：${e.message}`, 'error'); }
    fileInput.value = '';
  });
  const copyBtn = el('button', { class: 'btn btn-quiet' });
  copyBtn.innerHTML = icon('copy', 15) + '<span>复制备份</span>';
  copyBtn.addEventListener('click', async () => {
    try {
      await copyToClipboard(exportJSON());
      toast('备份内容已复制，可粘贴到微信等应用', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  const shareBtn = el('button', { class: 'btn btn-quiet' });
  shareBtn.innerHTML = icon('share', 15) + '<span>分享备份</span>';
  shareBtn.addEventListener('click', async () => {
    const text = exportJSON();
    if (!navigator.share) {
      try {
        await copyToClipboard(text);
        toast('当前浏览器不支持分享，已复制到剪贴板', 'success');
      } catch (e) { toast(e.message, 'error'); }
      return;
    }
    try {
      const name = `拾词备份_${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '拾词备份' });
      } else {
        await navigator.share({ title: '拾词备份', text });
      }
      toast('已分享', 'success');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast(`分享失败：${e.message}`, 'error');
    }
  });

  const pasteBtn = el('button', { class: 'btn btn-quiet' });
  pasteBtn.innerHTML = icon('upload', 15) + '<span>粘贴导入</span>';
  pasteBtn.addEventListener('click', () => openPasteImport());

  dataRow.append(expBtn, copyBtn, shareBtn, impBtn, pasteBtn, fileInput);
  dataSec.appendChild(dataRow);
  body.appendChild(dataSec);

  /* 局域网直传 */
  const xferSec = el('div', { class: 'settings-section' });
  xferSec.appendChild(el('h3', { text: '局域网直传' }));
  xferSec.appendChild(el('p', {
    text: '免账号：两台设备互换两段配对串，数据直接点对点传输，不经过服务器。适合「换手机」或「把手机上的词搬到电脑」。',
  }));
  const xferBtn = el('button', { class: 'btn btn-quiet' });
  xferBtn.innerHTML = icon('wifi', 15) + '<span>开始直传</span>';
  xferBtn.addEventListener('click', () => { ref.close(); openTransferDialog(); });
  xferSec.appendChild(xferBtn);
  body.appendChild(xferSec);

  /* 同步 */
  const syncSec = el('div', { class: 'settings-section' });
  syncSec.appendChild(el('h3', { text: '云同步' }));
  syncSec.appendChild(el('p', { text: '配置 Supabase 后，可在多台设备上登录同一个账号并同步数据。' }));
  const syncBtn = el('button', { class: 'btn btn-quiet' });
  syncBtn.innerHTML = icon('sync', 15) + '<span>配置云同步</span>';
  syncBtn.addEventListener('click', () => { ref.close(); openSyncDialog(); });
  syncSec.appendChild(syncBtn);
  body.appendChild(syncSec);

  const foot = el('div', { style: 'display:flex;gap:9px;width:100%;justify-content:flex-end' });
  const close = el('button', { class: 'btn btn-primary', text: '完成' });
  close.addEventListener('click', () => {
    updateSettings({
      aiProvider: providerSel.value,
      aiBaseUrl: baseInput.value.trim(),
      aiModel: modelInput.value.trim(),
      aiKey: keyInput.value.trim(),
    });
    ref.close();
    render();
  });
  foot.appendChild(close);

  const ref = openModal({ title: '设置', body, footer: foot, wide: true });
}

/* ==================== 同步 ==================== */

/* ==================== 局域网直传（免账号 · 点对点） ==================== */

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (ok) resolve(); else reject(new Error('复制失败，请长按文本框手动复制'));
  });
}

function incomingInfo(text) {
  const data = JSON.parse(text);
  return {
    books: (data.books || []).length,
    words: (data.words || []).length,
  };
}

/** 收到数据后询问「合并 / 覆盖」 */
function applyIncoming(text) {
  let info;
  try {
    info = incomingInfo(text);
  } catch (e) {
    toast('收到的数据无法解析，可能是传输中断', 'error');
    return;
  }
  const body = el('div', {},
    el('p', { class: 'muted', text: `对方共有 ${info.books} 个单词本、${info.words} 个单词。` }),
    el('ul', { class: 'xfer-tips' },
      el('li', { text: '合并：按单词本与单词对齐，重复的单词权重取较大值，不删除本机内容。' }),
      el('li', { text: '覆盖：用对方的数据替换本机全部内容，本机现有数据会丢弃。' }),
    ),
  );
  const mergeBtn = el('button', { class: 'btn btn-primary', text: '合并到本机' });
  const replaceBtn = el('button', { class: 'btn btn-quiet', text: '覆盖本机' });
  const cancelBtn = el('button', { class: 'btn btn-quiet', text: '取消' });
  const ref = openModal({
    title: '收到数据',
    subtitle: '选择如何写入本机',
    body,
    footer: el('div', { style: 'display:flex;gap:8px;margin-left:auto' }, [cancelBtn, replaceBtn, mergeBtn]),
  });
  cancelBtn.addEventListener('click', () => ref.close());
  const write = (mode) => {
    try {
      importJSON(text, mode);
      ref.close();
      renderAfterDataChange();
      toast(mode === 'replace' ? '已覆盖本机数据' : '已合并到本机', 'success');
    } catch (e) {
      toast(`写入失败：${e.message}`, 'error');
    }
  };
  mergeBtn.addEventListener('click', () => write('merge'));
  replaceBtn.addEventListener('click', () => write('replace'));
}

export function openTransferDialog() {
  let sender = null;
  let receiver = null;

  const body = el('div', {});
  body.appendChild(el('p', {
    class: 'muted',
    text: '两台设备都打开同一个网址：一端在「发送」生成配对串，另一端在「接收」粘贴并回传应答串。连接建立后数据在两台设备之间直接传输，不经过任何服务器。',
  }));

  const makeCodeBox = () => el('textarea', {
    class: 'xfer-code',
    rows: '3',
    readonly: 'readonly',
    placeholder: '点下面的按钮生成',
  });

  const makeBar = () => {
    const bar = el('div', { class: 'xfer-bar' }, el('i', {}));
    bar.firstChild.style.width = '0%';
    return bar;
  };

  const setBar = (bar, pct) => { bar.firstChild.style.width = Math.round(pct * 100) + '%'; };

  /* ---------- 发送 ---------- */
  const sendCard = el('div', { class: 'xfer-card' });
  sendCard.appendChild(el('h3', { text: '发送本机数据' }));
  const sendStatus = el('div', { class: 'xfer-status', text: '第 1 步：生成配对串，发给另一台设备。' });
  const sendCode = makeCodeBox();
  const sendGen = el('button', { class: 'btn btn-primary', text: '① 生成配对串' });
  const sendCopy = el('button', { class: 'btn btn-quiet', text: '复制', disabled: 'disabled' });
  const sendIn = el('textarea', {
    class: 'xfer-code',
    rows: '3',
    placeholder: '第 2 步：粘贴对方回传的应答串',
  });
  const sendGo = el('button', { class: 'btn btn-primary', text: '② 连接并发送', disabled: 'disabled' });
  const sendBar = makeBar();
  sendCard.append(
    sendStatus,
    sendCode,
    el('div', { class: 'xfer-actions' }, [sendGen, sendCopy]),
    sendIn,
    el('div', { class: 'xfer-actions' }, [sendGo]),
    sendBar,
  );

  sendGen.addEventListener('click', async () => {
    sendGen.disabled = true;
    try {
      if (sender) sender.close();
      sender = new Transfer();
      const code = await sender.createOffer();
      sendCode.value = code;
      sendCopy.disabled = false;
      sendGo.disabled = false;
      sendStatus.textContent = '把上面的配对串发给另一台设备（微信、QQ、隔空投送都行），等它生成应答串回传。';
    } catch (e) {
      sendStatus.textContent = `生成失败：${e.message}`;
      sendGen.disabled = false;
    }
  });

  sendCopy.addEventListener('click', async () => {
    try {
      await copyToClipboard(sendCode.value);
      toast('配对串已复制', 'success');
    } catch (e) {
      sendCode.select();
      toast(e.message, 'error');
    }
  });

  sendGo.addEventListener('click', async () => {
    const code = sendIn.value.trim();
    if (!code) { toast('先粘贴对方回传的应答串', 'error'); return; }
    sendGo.disabled = true;
    sendStatus.textContent = '正在连接，请让另一台设备保持页面打开…';
    try {
      if (!sender) throw new Error('请先点「① 生成配对串」');
      sender.onProgress = (p) => setBar(sendBar, p * 0.7);
      await sender.applyAnswer(code);
      setBar(sendBar, 0.7);
      sendStatus.textContent = '已连接，正在发送…';
      await sender.send(exportJSON());
      setBar(sendBar, 1);
      sendStatus.textContent = '已发送完成。对方点「合并到本机」后即生效。';
      toast('已发送', 'success');
    } catch (e) {
      sendStatus.textContent = `发送失败：${e.message}`;
      sendGo.disabled = false;
    }
  });

  /* ---------- 接收 ---------- */
  const recvCard = el('div', { class: 'xfer-card' });
  recvCard.appendChild(el('h3', { text: '接收另一台设备的数据' }));
  const recvStatus = el('div', { class: 'xfer-status', text: '第 1 步：粘贴对方发来的配对串。' });
  const recvIn = el('textarea', { class: 'xfer-code', rows: '3', placeholder: '在这里粘贴对方发来的配对串' });
  const recvMake = el('button', { class: 'btn btn-primary', text: '① 生成应答串' });
  const recvCode = makeCodeBox();
  const recvCopy = el('button', { class: 'btn btn-quiet', text: '复制', disabled: 'disabled' });
  const recvBar = makeBar();
  recvCard.append(
    recvStatus,
    recvIn,
    el('div', { class: 'xfer-actions' }, [recvMake]),
    recvCode,
    el('div', { class: 'xfer-actions' }, [recvCopy]),
    recvBar,
  );

  recvMake.addEventListener('click', async () => {
    const code = recvIn.value.trim();
    if (!code) { toast('先粘贴对方的配对串', 'error'); return; }
    recvMake.disabled = true;
    try {
      if (receiver) receiver.close();
      receiver = new Transfer();
      receiver.onProgress = (p) => setBar(recvBar, p);
      receiver.onData = (text) => {
        setBar(recvBar, 1);
        recvStatus.textContent = '已收到对方的数据。';
        applyIncoming(text);
      };
      const answer = await receiver.acceptOffer(code);
      recvCode.value = answer;
      recvCopy.disabled = false;
      recvStatus.textContent = '把应答串发回给对方，等它点「② 连接并发送」。保持本页面打开。';
    } catch (e) {
      recvStatus.textContent = `生成失败：${e.message}`;
      recvMake.disabled = false;
    }
  });

  recvCopy.addEventListener('click', async () => {
    try {
      await copyToClipboard(recvCode.value);
      toast('应答串已复制', 'success');
    } catch (e) {
      recvCode.select();
      toast(e.message, 'error');
    }
  });

  /* ---------- 发送 / 接收 切换 ---------- */
  const tabSend = el('button', { class: 'xfer-tab on', type: 'button', text: '我要发送' });
  const tabRecv = el('button', { class: 'xfer-tab', type: 'button', text: '我要接收' });
  const tabs = el('div', { class: 'xfer-tabs' }, [tabSend, tabRecv]);
  const showTab = (which) => {
    const isSend = which === 'send';
    sendCard.classList.toggle('hidden', !isSend);
    recvCard.classList.toggle('hidden', isSend);
    tabSend.classList.toggle('on', isSend);
    tabRecv.classList.toggle('on', !isSend);
  };
  tabSend.addEventListener('click', () => showTab('send'));
  tabRecv.addEventListener('click', () => showTab('recv'));

  body.append(tabs, sendCard, recvCard);
  showTab('send');

  const closeBtn = el('button', { class: 'btn btn-quiet', text: '关闭' });
  const ref = openModal({
    title: '局域网直传',
    subtitle: '免账号 · 点对点，数据不经过服务器',
    body,
    footer: el('div', { style: 'display:flex;gap:8px;margin-left:auto' }, [closeBtn]),
    wide: true,
    onClose: () => {
      if (sender) sender.close();
      if (receiver) receiver.close();
      sender = null;
      receiver = null;
    },
  });
  closeBtn.addEventListener('click', () => ref.close());
}

export function openSyncDialog() {
  const body = el('div', {});
  let auth = authSummary();

  /* ---------- 1. 项目配置 ---------- */
  const cfgSec = el('div', { class: 'settings-section' });
  cfgSec.appendChild(el('h3', { text: '1 · Supabase 项目' }));
  const cfgPara = el('p', {
    text: '在 supabase.com 免费建一个项目，复制 Project URL 与 anon public key 填进来。各设备填同一套配置、登录同一个账号，即可共享同一份单词本。',
  });
  cfgSec.appendChild(cfgPara);

  const s = getSettings();
  const cfgNow = syncConfig();
  if (cfgNow.builtin && cfgNow.ready) {
    cfgSec.appendChild(el('p', {
      style: 'margin:0 0 8px;color:var(--ink-2);font-size:12.5px',
      text: '本站已内置云服务，无需填写项目地址与密钥；直接在第 2 段登录即可使用。',
    }));
    body.appendChild(cfgSec);
  }
  const urlInput = el('input', {
    class: 'text-input', placeholder: 'https://xxxxxxxx.supabase.co', value: s.supabaseUrl || '',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  const keyInput = el('input', {
    class: 'text-input', placeholder: 'anon public key（eyJhbGciOi…）', value: s.supabaseKey || '',
    style: 'margin-top:9px', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  const cfgRow = el('div', { style: 'display:flex;gap:9px;margin-top:11px;align-items:center;flex-wrap:wrap' });
  const saveCfg = el('button', { class: 'btn btn-quiet', text: '保存配置' });
  const cfgState = el('span', { style: 'font-size:12px;color:var(--ink-3)' });
  saveCfg.addEventListener('click', () => {
    updateSettings({ supabaseUrl: urlInput.value.trim().replace(/\/+$/, ''), supabaseKey: keyInput.value.trim() });
    const c = syncConfig();
    cfgState.style.color = c.ready ? 'var(--green)' : 'var(--accent)';
    cfgState.textContent = c.ready ? '✓ 已保存' : 'URL 或 key 看起来不完整';
  });
  cfgRow.append(saveCfg, cfgState);
  if (cfgNow.builtin && cfgNow.ready) {
    cfgPara.style.display = 'none';
    urlInput.style.display = 'none';
    keyInput.style.display = 'none';
    cfgRow.style.display = 'none';
  }
  cfgSec.append(urlInput, keyInput, cfgRow);
  body.appendChild(cfgSec);

  /* ---------- 2. 账号 ---------- */
  const accSec = el('div', { class: 'settings-section' });
  accSec.appendChild(el('h3', { text: '2 · 账号' }));
  const accInfo = el('p', {});
  accSec.appendChild(accInfo);

  const form = el('div', {});
  const emailInput = el('input', {
    class: 'text-input', type: 'email', placeholder: '邮箱', value: auth?.email || '',
    autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false',
  });
  const pwdInput = el('input', {
    class: 'text-input', type: 'password', placeholder: '密码（至少 6 位）', style: 'margin-top:9px',
    autocomplete: 'current-password',
  });
  form.append(emailInput, pwdInput);

  const authRow = el('div', { style: 'display:flex;gap:9px;margin-top:11px;align-items:center;flex-wrap:wrap' });
  const loginBtn = el('button', { class: 'btn btn-primary', text: '登录' });
  const signupBtn = el('button', { class: 'btn btn-quiet', text: '注册新账号' });
  const anonBtn = el('button', { class: 'btn btn-quiet', text: '免注册使用（匿名）' });
  const outBtn = el('button', { class: 'btn btn-quiet', text: '退出登录' });
  const accMsg = el('span', { style: 'font-size:12px;color:var(--ink-3);flex:1;min-width:0' });
  authRow.append(loginBtn, signupBtn, anonBtn, outBtn, accMsg);
  accSec.append(form, authRow);
  body.appendChild(accSec);

  /* ---------- 3. 同步 ---------- */
  const syncSec = el('div', { class: 'settings-section' });
  syncSec.appendChild(el('h3', { text: '3 · 同步' }));
  const syncInfo = el('p', {});
  syncSec.appendChild(syncInfo);
  const syncRow = el('div', { style: 'display:flex;gap:9px;align-items:center;flex-wrap:wrap' });
  const syncBtn = el('button', { class: 'btn btn-primary' });
  syncBtn.innerHTML = icon('refresh', 15) + '<span>立即同步</span>';
  const pullBtn = el('button', { class: 'btn btn-quiet', text: '从云端恢复' });
  const pushBtn = el('button', { class: 'btn btn-quiet', text: '上传本机' });
  const syncMsg = el('span', { style: 'font-size:12px;color:var(--ink-3);flex:1;min-width:0' });
  syncRow.append(syncBtn, pullBtn, pushBtn);
  syncSec.append(syncRow, syncMsg);
  body.appendChild(syncSec);

  /* ---------- 4. 建表 SQL ---------- */
  const sqlSec = el('details', { class: 'settings-section' });
  const sqlSum = el('summary', { style: 'cursor:pointer;font-size:12.5px;color:var(--ink-2)' });
  sqlSum.textContent = '首次使用：点开复制建表 SQL（在 Supabase → SQL Editor 里执行一次）';
  sqlSec.appendChild(sqlSum);
  const sqlBox = el('textarea', {
    class: 'text-area', readonly: 'readonly', rows: '9',
    style: 'margin-top:10px;font-family:var(--mono);font-size:11.5px;line-height:1.6',
    value: SYNC_SQL,
  });
  const copyRow = el('div', { style: 'display:flex;gap:9px;margin-top:8px;align-items:center' });
  const copyBtn = el('button', { class: 'btn btn-quiet', text: '复制 SQL' });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(SYNC_SQL);
      toast('已复制', 'success');
    } catch {
      sqlBox.select();
      toast('请手动复制（已全选）', 'default');
    }
  });
  copyRow.appendChild(copyBtn);
  sqlSec.append(sqlBox, copyRow);
  body.appendChild(sqlSec);

  /* ---------- 状态刷新 ---------- */
  function refreshAuth() {
    auth = authSummary();
    const logged = Boolean(auth);
    form.style.display = logged ? 'none' : '';
    loginBtn.style.display = logged ? 'none' : '';
    signupBtn.style.display = logged ? 'none' : '';
    anonBtn.style.display = logged ? 'none' : '';
    outBtn.style.display = logged ? '' : 'none';
    syncSec.style.display = logged ? '' : 'none';

    if (auth) {
      accInfo.textContent = auth.anon
        ? '已登录：匿名账号（仅本设备）'
        : `已登录：${auth.email}`;
      syncInfo.textContent = auth.lastSyncAt
        ? `上次同步：${relativeTime(auth.lastSyncAt)}。同步会把云端与这台设备的数据合并（权重取较大值），再整体回传。`
        : '还没有同步过。建议先在一台设备上点「上传本机」，其他设备再点「立即同步」拉取。';
    } else {
      accInfo.textContent = '用邮箱注册一个账号，各设备登录同一个账号即可同步；'
        + '也可点「免注册使用（匿名）」，无需邮箱，仅本设备生效。';
    }
  }

  function wrapBusy(btn, fn) {
    return async () => {
      const old = btn.innerHTML;
      btn.disabled = true;
      try { await fn(); } catch (e) {
        const m = String(e.message || e);
        accMsg.style.color = 'var(--accent)';
        syncMsg.style.color = 'var(--accent)';
        accMsg.textContent = m;
        syncMsg.textContent = m;
        toast(m, 'error', 4200);
      } finally { btn.disabled = false; btn.innerHTML = old; }
    };
  }

  anonBtn.addEventListener('click', wrapBusy(anonBtn, async () => {
    const c = syncConfig();
    if (!c.ready) throw new Error('请先填写并保存 Supabase 配置');
    accMsg.style.color = 'var(--ink-3)';
    accMsg.textContent = '正在建立匿名账号…';
    await signInAnon();
    refreshAuth();
    accMsg.style.color = 'var(--green)';
    accMsg.textContent = '已建立匿名账号，可直接同步';
    toast('已建立匿名账号', 'success');
  }));

  loginBtn.addEventListener('click', wrapBusy(loginBtn, async () => {
    const email = emailInput.value.trim();
    const pwd = pwdInput.value;
    if (!email || !pwd) throw new Error('请填写邮箱和密码');
    const c = syncConfig();
    if (!c.ready) throw new Error('请先填写并保存 Supabase 配置');
    accMsg.style.color = 'var(--ink-3)';
    accMsg.textContent = '登录中…';
    await signIn(email, pwd);
    pwdInput.value = '';
    refreshAuth();
    toast('登录成功', 'success');
  }));

  signupBtn.addEventListener('click', wrapBusy(signupBtn, async () => {
    const email = emailInput.value.trim();
    const pwd = pwdInput.value;
    if (!email || !pwd) throw new Error('请填写邮箱和密码');
    if (pwd.length < 6) throw new Error('密码至少 6 位');
    const c = syncConfig();
    if (!c.ready) throw new Error('请先填写并保存 Supabase 配置');
    accMsg.style.color = 'var(--ink-3)';
    accMsg.textContent = '注册中…';
    const r = await signUp(email, pwd);
    if (r.needConfirm) {
      accMsg.style.color = 'var(--amber)';
      accMsg.textContent = '注册成功，请到邮箱点击确认链接后再回来登录';
      toast('请查收确认邮件', 'default', 4200);
    } else {
      pwdInput.value = '';
      refreshAuth();
      toast('注册并登录成功', 'success');
    }
  }));

  outBtn.addEventListener('click', async () => {
    signOut();
    refreshAuth();
    toast('已退出登录');
  });

  syncBtn.addEventListener('click', wrapBusy(syncBtn, async () => {
    if (!auth) throw new Error('请先登录');
    syncMsg.style.color = 'var(--ink-3)';
    syncMsg.textContent = '同步中…';
    const r = await syncNow();
    syncMsg.style.color = 'var(--green)';
    syncMsg.textContent = r.message;
    refreshAuth();
    window.dispatchEvent(new CustomEvent('vn:data-changed'));
    toast(r.message, 'success');
  }));

  pullBtn.addEventListener('click', wrapBusy(pullBtn, async () => {
    if (!auth) throw new Error('请先登录');
    const ok = await confirmDialog({
      title: '从云端恢复',
      message: '将用云端数据完整替换这台设备上的数据，本机未同步的内容会丢失。确定继续吗？',
      confirmText: '替换', danger: true,
    });
    if (!ok) return;
    syncMsg.style.color = 'var(--ink-3)';
    syncMsg.textContent = '拉取中…';
    const data = await pullRemote();
    if (!data) { syncMsg.textContent = '云端还没有数据'; return; }
    importJSON(JSON.stringify(data), 'replace');
    updateSettings({ lastSyncAt: Date.now() });
    syncMsg.style.color = 'var(--green)';
    syncMsg.textContent = '已用云端数据替换本机';
    window.dispatchEvent(new CustomEvent('vn:data-changed'));
  }));

  pushBtn.addEventListener('click', wrapBusy(pushBtn, async () => {
    if (!auth) throw new Error('请先登录');
    const ok = await confirmDialog({
      title: '上传本机',
      message: '将用这台设备的数据覆盖云端数据（其他设备之后再同步时会以云端为准）。确定继续吗？',
      confirmText: '上传', danger: true,
    });
    if (!ok) return;
    syncMsg.style.color = 'var(--ink-3)';
    syncMsg.textContent = '上传中…';
    await pushOverride();
    syncMsg.style.color = 'var(--green)';
    syncMsg.textContent = '已上传到云端';
    toast('已上传', 'success');
  }));

  const foot = el('div', { style: 'display:flex;gap:9px;width:100%;justify-content:flex-end' });
  const close = el('button', { class: 'btn btn-quiet', text: '关闭' });
  foot.appendChild(close);

  refreshAuth();
  const ref = openModal({ title: '云同步', subtitle: '多台设备共用一份单词本', body, footer: foot, wide: true });
  close.addEventListener('click', () => ref.close());
}
export function openAboutDialog() {
  const body = el('div', {});
  body.appendChild(el('p', {
    text: '一个在浏览器中运行的电子英语单词本：桌面、平板与手机均可使用。数据默认保存在本机，可离线使用；配置 Supabase 后多台设备共享同一份单词本。',
    style: 'font-size:13.5px;color:var(--ink-2);line-height:1.8;margin:0 0 16px',
  }));
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--ink-2);line-height:1.7' });
  const item = (t, d) => {
    const r = el('div', { style: 'display:flex;gap:10px' });
    r.append(el('span', { style: 'color:var(--accent);flex:none', text: '·' }), el('span', { html: `<b>${esc(t)}</b>　${esc(d)}` }));
    return r;
  };
  list.append(
    item('多单词本', '自定义名称与颜色，独立计数'),
    item('权重', '首次加入为 1，重复录入自动 +1，直接显示在单词旁'),
    item('AI 分类', '录入时自动判断该归入哪几个单词本'),
    item('词云', '力导向关系图，词团可重叠且视觉可辨'),
    item('安装', '浏览器里选择「安装到桌面」或「添加到主屏幕」即可离线使用')
  );
  body.appendChild(list);

  const books = getBooks();
  const canSeed = books.length === 1 && getEntriesOfBook(books[0].id).length === 0;
  const foot = el('div', { style: 'display:flex;gap:9px;align-items:center;width:100%' });
  foot.appendChild(el('span', { style: 'font-size:11.5px;color:var(--ink-3);flex:1', text: 'v1.2.0.0 · 本地优先 · 离线可用' }));
  if (canSeed) {
    const demoBtn = el('button', { class: 'btn btn-quiet', text: '载入示例数据' });
    demoBtn.addEventListener('click', async () => {
      demoBtn.disabled = true;
      try {
        const mod = await import('./demo.js');
        const seeded = mod.seedDemo();
        if (seeded) {
          selectBook(getBooks()[0].id);
          renderAfterDataChange();
          toast('已载入示例数据：两个单词本、9 个词团', 'success', 3000);
        } else {
          toast('当前数据不满足示例载入条件', 'default');
        }
      } catch (err) {
        console.warn('[demo]', err);
        toast('示例数据载入失败', 'error');
      }
      close();
    });
    foot.appendChild(demoBtn);
  }
  const ok = el('button', { class: 'btn btn-primary', text: '知道了' });
  foot.appendChild(ok);

  const modal = openModal({ title: '关于「拾词」', body, footer: foot });
  ok.addEventListener('click', () => modal.close());
  const close = () => modal.close();
}

/* ==================== 移动端侧栏 ==================== */

export function openSidebar() {
  $('#sidebar')?.classList.add('open');
  const scrim = $('#scrim');
  if (scrim) {
    scrim.hidden = false;
    scrim.onclick = closeSidebar;
  }
}

export function closeSidebar() {
  $('#sidebar')?.classList.remove('open');
  const scrim = $('#scrim');
  if (scrim) { scrim.hidden = true; scrim.onclick = null; }
}

/* ==================== 总渲染 ==================== */

let lastKey = '';

export function render() {
  const books = getBooks();
  if (!books.length) return;
  if (!vs.bookId || !getBook(vs.bookId)) selectBook(books[0].id);

  renderSidebar();
  renderTopbar();
  renderToolbar();

  const key = `${vs.bookId}|${vs.view}`;
  const view = $('#view');

  if (key !== lastKey) {
    lastKey = key;
    view.innerHTML = '';
    if (vs.view === 'list') {
      const content = el('div', { class: 'content', id: 'content' });
      const host = el('div', { class: 'word-list', id: 'list-host' });
      content.appendChild(host);
      view.appendChild(content);
    }
  }

  if (vs.view === 'list') {
    renderListOnly();
  } else {
    import('./cloudview.js').then((m) => m.renderCloudView(view));
  }
}

/** 只更新列表，不重建工具栏（保持搜索框焦点） */
export function renderAfterDataChange() {
  if (vs.view === 'list') renderListOnly();
  renderSidebar();
  renderTopbar();
}
