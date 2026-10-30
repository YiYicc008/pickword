/* 数据层：单词本 / 单词 / 词条权重 / 关系 / 词团 / 词云 */

import { uid, termKey, normalizeTerm, clone } from './util.js';

export const BOOK_COLORS = ['#b8452f', '#2f5d7c', '#3f7d5a', '#c98a2e', '#6b5b95', '#a04b6b', '#3a7b8c', '#8b6f3a'];
export const CLUSTER_COLORS = ['#b8452f', '#2f5d7c', '#3f7d5a', '#c98a2e', '#6b5b95', '#a04b6b', '#3a7b8c', '#8b6f3a', '#5d7a3a', '#8c5a2f'];

export const REL_TYPES = {
  variant: { label: '变式', color: '#2f5d7c', desc: '同一词根的不同形式' },
  synonym: { label: '同义词', color: '#3f7d5a', desc: '语义相近' },
  antonym: { label: '反义词', color: '#b8452f', desc: '语义相反' },
  lookalike: { label: '形近词', color: '#c98a2e', desc: '拼写相近易混' },
  custom: { label: '自定义', color: '#6b5b95', desc: '手动建立的联系' },
};

const STORAGE_KEY = 'vn.state.v2';
const DEMO_KEY = 'vn.demo.v2';

const DEFAULT_SETTINGS = {
  aiProvider: 'deepseek',
  aiBaseUrl: 'https://api.deepseek.com',
  aiModel: 'deepseek-chat',
  aiKey: '',
  autoEnrich: true,
  dictApi: true,
  spellcheck: true,
  ttsRate: 0.9,
  theme: 'light',
  supabaseUrl: '',
  supabaseKey: '',
  lastSyncAt: null,
};

export const DEMO_MODE = new URLSearchParams(location.search).has('demo');
const key = DEMO_MODE ? DEMO_KEY : STORAGE_KEY;

const emptyState = () => ({
  version: 2,
  books: [],
  words: [],
  entries: [],
  links: [],
  clusters: [],
  clouds: [],
  settings: { ...DEFAULT_SETTINGS },
});

let state = emptyState();
const listeners = new Set();
const index = {
  wordsById: new Map(),
  wordsByKey: new Map(),
  entriesByBookWord: new Map(), // `${bookId}|${wordId}` -> entry
  entriesByBook: new Map(), // bookId -> [entry]
};

/* ---------------- 索引 ---------------- */

function reindex() {
  index.wordsById.clear();
  index.wordsByKey.clear();
  index.entriesByBookWord.clear();
  index.entriesByBook.clear();
  for (const w of state.words) {
    index.wordsById.set(w.id, w);
    index.wordsByKey.set(w.key, w);
  }
  for (const e of state.entries) {
    index.entriesByBookWord.set(`${e.bookId}|${e.wordId}`, e);
    if (!index.entriesByBook.has(e.bookId)) index.entriesByBook.set(e.bookId, []);
    index.entriesByBook.get(e.bookId).push(e);
  }
}

/* ---------------- 持久化 ---------------- */

let saveTimer = null;
let dirty = false;

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 120);
}

export function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (err) {
    console.error('[store] 保存失败', err);
    emit('error', { message: '本地存储写入失败，可能空间已满' });
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...emptyState(), ...parsed };
      state.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    }
  } catch (err) {
    console.error('[store] 读取失败', err);
    state = emptyState();
  }
  reindex();
  if (!state.books.length) {
    const b = createBook('我的单词本', { silent: true });
    state.meta = state.meta || {};
  }
  return state;
}

/* ---------------- 事件 ---------------- */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(type = 'change', payload = null) {
  for (const fn of listeners) {
    try { fn(type, payload); } catch (e) { console.error(e); }
  }
}

function commit(type = 'change', payload = null) {
  reindex();
  scheduleSave();
  emit(type, payload);
}

/* ---------------- 查询 ---------------- */

export const getState = () => state;
export const getSettings = () => state.settings;

export const getBooks = () =>
  [...state.books].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);

export const getBook = (id) => state.books.find((b) => b.id === id) || null;
export const getWord = (id) => index.wordsById.get(id) || null;
export const getWordByTerm = (term) => index.wordsByKey.get(termKey(term)) || null;

export const getEntriesOfBook = (bookId) => {
  const list = index.entriesByBook.get(bookId) || [];
  return list
    .map((e) => ({ entry: e, word: index.wordsById.get(e.wordId) }))
    .filter((x) => x.word);
};

export const getEntry = (bookId, wordId) =>
  index.entriesByBookWord.get(`${bookId}|${wordId}`) || null;

export const getBooksOfWord = (wordId) =>
  state.entries.filter((e) => e.wordId === wordId).map((e) => ({ entry: e, book: getBook(e.bookId) })).filter((x) => x.book);

export const bookStats = (bookId) => {
  const list = getEntriesOfBook(bookId);
  let totalWeight = 0;
  let maxWeight = 0;
  for (const { entry } of list) {
    totalWeight += entry.weight;
    if (entry.weight > maxWeight) maxWeight = entry.weight;
  }
  return { count: list.length, totalWeight, maxWeight };
};

export const getLinks = (bookId = null) => {
  if (!bookId) return state.links;
  const ids = new Set(getEntriesOfBook(bookId).map((x) => x.word.id));
  return state.links.filter((l) => ids.has(l.a) && ids.has(l.b));
};

export const getClusters = (bookId) => state.clusters.filter((c) => c.bookId === bookId);
export const getClouds = (bookId) => state.clouds.filter((c) => c.bookId === bookId);

/* ---------------- 单词本 ---------------- */

export function createBook(name, opts = {}) {
  const clean = normalizeTerm(name) || '未命名词本';
  const order = Math.max(0, ...state.books.map((b) => b.order ?? 0)) + 1;
  const book = {
    id: uid('bk'),
    name: clean,
    color: opts.color || BOOK_COLORS[state.books.length % BOOK_COLORS.length],
    createdAt: Date.now(),
    order,
  };
  state.books.push(book);
  if (!opts.silent) commit('books');
  return book;
}

export function updateBook(id, patch) {
  const b = getBook(id);
  if (!b) return null;
  Object.assign(b, patch);
  commit('books');
  return b;
}

export function deleteBook(id) {
  if (state.books.length <= 1) return { ok: false, reason: '至少需要保留一个单词本' };
  state.books = state.books.filter((b) => b.id !== id);
  state.entries = state.entries.filter((e) => e.bookId !== id);
  state.clusters = state.clusters.filter((c) => c.bookId !== id);
  state.clouds = state.clouds.filter((c) => c.bookId !== id);
  pruneOrphanWords();
  commit('books');
  return { ok: true };
}

/** 清空某个单词本里的全部词条，但不删单词本本身 */
export function clearBook(bookId) {
  state.entries = state.entries.filter((e) => e.bookId !== bookId);
  state.clusters = state.clusters.filter((c) => c.bookId !== bookId);
  state.clouds = state.clouds.filter((c) => c.bookId !== bookId);
  pruneOrphanWords();
  commit('books');
}

function pruneOrphanWords() {
  const used = new Set(state.entries.map((e) => e.wordId));
  state.words = state.words.filter((w) => used.has(w.id));
  state.links = state.links.filter((l) => used.has(l.a) && used.has(l.b));
}

/* ---------------- 录入核心：权重规则 ---------------- */

/**
 * 把一个单词加入若干个单词本。
 * 规则（需求 5）：首次加入权重为 1；同一单词重复进入同一单词本则权重 +1。
 * @returns {{word, results: Array<{bookId, entry, isNew, weight, delta}>}}
 */
export function addTerm(rawTerm, bookIds = [], extra = {}) {
  const term = normalizeTerm(rawTerm);
  if (!term) return null;
  const k = termKey(term);
  const targets = [...new Set(bookIds)].filter((id) => getBook(id));
  if (!targets.length) return null;

  let word = index.wordsByKey.get(k);
  let createdWord = false;
  if (!word) {
    word = {
      id: uid('w'),
      term,
      key: k,
      phonetic: extra.phonetic || '',
      audio: extra.audio || '',
      pos: extra.pos || [],
      meaningZh: extra.meaningZh || '',
      defsEn: extra.defsEn || [],
      note: extra.note || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      enrichState: extra.enrichState || 'pending',
    };
    state.words.push(word);
    createdWord = true;
  }

  const now = Date.now();
  const results = [];
  for (const bookId of targets) {
    let entry = index.entriesByBookWord.get(`${bookId}|${word.id}`);
    if (entry) {
      entry.weight += 1;
      entry.lastAddedAt = now;
      results.push({ bookId, entry, isNew: false, weight: entry.weight, delta: 1 });
    } else {
      entry = {
        id: uid('e'),
        bookId,
        wordId: word.id,
        weight: 1,
        firstAddedAt: now,
        lastAddedAt: now,
      };
      state.entries.push(entry);
      index.entriesByBookWord.set(`${bookId}|${word.id}`, entry);
      results.push({ bookId, entry, isNew: true, weight: 1, delta: 1 });
    }
  }

  commit('entries', { word, results, createdWord });
  return { word, results };
}

export function updateWord(id, patch) {
  const w = getWord(id);
  if (!w) return null;
  Object.assign(w, patch, { updatedAt: Date.now() });
  commit('words');
  return w;
}

export function adjustWeight(entryId, delta) {
  const e = state.entries.find((x) => x.id === entryId);
  if (!e) return;
  e.weight = Math.max(1, e.weight + delta);
  commit('entries');
}

export function removeEntry(entryId) {
  const e = state.entries.find((x) => x.id === entryId);
  if (!e) return;
  state.entries = state.entries.filter((x) => x.id !== entryId);
  pruneOrphanWords();
  commit('entries');
}

/* ---------------- 关系与词团 ---------------- */

export function addLink(a, b, type = 'custom', note = '') {
  if (a === b || !getWord(a) || !getWord(b)) return null;
  const exists = state.links.find(
    (l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)
  );
  if (exists) {
    exists.type = type;
    if (note) exists.note = note;
    commit('links');
    return exists;
  }
  const link = { id: uid('l'), a, b, type, note, createdAt: Date.now() };
  state.links.push(link);
  commit('links');
  return link;
}

export function removeLink(id) {
  state.links = state.links.filter((l) => l.id !== id);
  commit('links');
}

export function replaceLinksFor(wordIds, links, source = 'ai') {
  const set = new Set(wordIds);
  state.links = state.links.filter(
    (l) => !(l.source === source && set.has(l.a) && set.has(l.b))
  );
  for (const l of links) {
    if (l.a === l.b || !getWord(l.a) || !getWord(l.b)) continue;
    state.links.push({
      id: uid('l'), a: l.a, b: l.b, type: l.type || 'custom',
      note: l.note || '', source, createdAt: Date.now(),
    });
  }
  commit('links');
}

export function createCluster(bookId, name, memberIds = [], kind = 'custom') {
  const cluster = {
    id: uid('cl'),
    bookId,
    name: normalizeTerm(name) || '未命名词团',
    kind,
    color: CLUSTER_COLORS[state.clusters.length % CLUSTER_COLORS.length],
    memberIds: [...new Set(memberIds)],
    createdAt: Date.now(),
    auto: false,
  };
  state.clusters.push(cluster);
  commit('clusters');
  return cluster;
}

/** 整体替换某个单词本的自动词团（保留用户手动创建的） */
export function applyAutoClusters(bookId, list) {
  state.clusters = state.clusters.filter((c) => !(c.bookId === bookId && c.auto));
  let i = 0;
  for (const item of list) {
    if (!item.memberIds || item.memberIds.length < 2) continue;
    state.clusters.push({
      id: uid('cl'),
      bookId,
      name: normalizeTerm(item.name) || `词团 ${++i}`,
      kind: item.kind || 'custom',
      color: CLUSTER_COLORS[state.clusters.length % CLUSTER_COLORS.length],
      memberIds: [...new Set(item.memberIds)],
      createdAt: Date.now(),
      auto: true,
    });
  }
  commit('clusters');
}

export function updateCluster(id, patch) {
  const c = state.clusters.find((x) => x.id === id);
  if (!c) return null;
  Object.assign(c, patch);
  commit('clusters');
  return c;
}

export function deleteCluster(id) {
  state.clusters = state.clusters.filter((c) => c.id !== id);
  for (const cloud of state.clouds) {
    cloud.clusterIds = cloud.clusterIds.filter((cid) => cid !== id);
  }
  commit('clusters');
}

export function toggleClusterMember(clusterId, wordId) {
  const c = state.clusters.find((x) => x.id === clusterId);
  if (!c) return;
  const i = c.memberIds.indexOf(wordId);
  if (i >= 0) c.memberIds.splice(i, 1);
  else c.memberIds.push(wordId);
  commit('clusters');
}

export function createCloud(bookId, name, clusterIds = []) {
  const cloud = {
    id: uid('cw'),
    bookId,
    name: normalizeTerm(name) || '未命名词云',
    clusterIds: [...clusterIds],
    createdAt: Date.now(),
  };
  state.clouds.push(cloud);
  commit('clouds');
  return cloud;
}

export function updateCloud(id, patch) {
  const c = state.clouds.find((x) => x.id === id);
  if (!c) return null;
  Object.assign(c, patch);
  commit('clouds');
  return c;
}

export function deleteCloud(id) {
  state.clouds = state.clouds.filter((c) => c.id !== id);
  commit('clouds');
}

/* ---------------- 设置 ---------------- */

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  commit('settings');
}

/* ---------------- 导入导出 / 同步用 ---------------- */

export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text, mode = 'merge') {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.words)) throw new Error('文件格式不正确');
  if (mode === 'replace') {
    state = { ...emptyState(), ...data };
    state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  } else {
    mergeState(data);
  }
  commit('import');
  return state;
}

function mergeState(data) {
  const bookMap = new Map();
  for (const b of data.books || []) bookMap.set(b.id, b);
  const existingBookIds = new Set(state.books.map((b) => b.id));
  for (const b of bookMap.values()) {
    if (!existingBookIds.has(b.id)) state.books.push(b);
  }
  const wordById = new Map(state.words.map((w) => [w.id, w]));
  const wordByKey = new Map(state.words.map((w) => [w.key, w]));
  const idRemap = new Map();
  for (const w of data.words || []) {
    const hit = wordByKey.get(w.key);
    if (hit) {
      idRemap.set(w.id, hit.id);
      Object.assign(hit, {
        phonetic: hit.phonetic || w.phonetic,
        audio: hit.audio || w.audio,
        meaningZh: hit.meaningZh || w.meaningZh,
        pos: (hit.pos && hit.pos.length) ? hit.pos : w.pos,
      });
    } else {
      state.words.push(w);
      wordById.set(w.id, w);
      wordByKey.set(w.key, w);
      idRemap.set(w.id, w.id);
    }
  }
  const entryMap = new Map(state.entries.map((e) => [`${e.bookId}|${e.wordId}`, e]));
  for (const e of data.entries || []) {
    const wid = idRemap.get(e.wordId) || e.wordId;
    const k = `${e.bookId}|${wid}`;
    const local = entryMap.get(k);
    if (local) {
      // 权重只增不减：两台设备各自累加时取较大值
      if ((e.weight || 1) > local.weight) local.weight = e.weight;
      if ((e.lastAddedAt || 0) > (local.lastAddedAt || 0)) local.lastAddedAt = e.lastAddedAt;
      continue;
    }
    if (!bookMap.has(e.bookId)) continue;
    state.entries.push({ ...e, wordId: wid });
    entryMap.set(k, e);
  }
  const linkKey = new Set(state.links.map((l) => `${l.a}|${l.b}|${l.type}`));
  for (const l of data.links || []) {
    const a = idRemap.get(l.a) || l.a;
    const b = idRemap.get(l.b) || l.b;
    const k = `${a}|${b}|${l.type}`;
    if (linkKey.has(k)) continue;
    state.links.push({ ...l, a, b });
    linkKey.add(k);
  }
  for (const c of data.clusters || []) {
    if (!state.clusters.some((x) => x.id === c.id)) {
      state.clusters.push({ ...c, memberIds: c.memberIds.map((m) => idRemap.get(m) || m) });
    }
  }
  for (const c of data.clouds || []) {
    if (!state.clouds.some((x) => x.id === c.id)) state.clouds.push(c);
  }
}

export function snapshot() {
  return clone(state);
}

export function replaceAll(next) {
  state = { ...emptyState(), ...next };
  state.settings = { ...DEFAULT_SETTINGS, ...(next.settings || {}) };
  commit('replace');
}

export function resetAll() {
  state = emptyState();
  reindex();
  commit('replace');
}
