/* 词团自动生成：关系连通分量 + 形态变式启发式 */

import { getEntriesOfBook, getLinks, REL_TYPES } from './store.js';

/** 粗糙但有效的词干还原，用于找同一单词的不同变式 */
export function morphStem(word) {
  let s = String(word).toLowerCase().trim();
  if (!/^[a-z]+$/.test(s)) return null;
  if (s.length <= 3) return null;

  const rules = [
    [/ies$/, 'y'], [/ves$/, 'f'], [/ches$/, 'ch'], [/shes$/, 'sh'],
    [/xes$/, 'x'], [/sses$/, 'ss'], [/zes$/, 'z'],
    [/ing$/, ''], [/ied$/, 'y'], [/ed$/, ''], [/es$/, ''], [/s$/, ''],
    [/ly$/, ''], [/est$/, ''], [/er$/, ''],
  ];
  for (const [re, rep] of rules) {
    if (re.test(s)) { s = s.replace(re, rep); break; }
  }
  // running -> runn -> run / stopped -> stopp -> stop
  if (/([bcdfgklmnprstvz])\1$/.test(s)) s = s.slice(0, -1);
  // making -> mak -> make
  if (s.length >= 4 && /[^aeiou][aeiou][bcdfgklmnpstvz]$/.test(s) && !/[aeiou]$/.test(s)) {
    // 保守处理：只在能匹配到同组另一个词时才生效（由调用方决定）
  }
  return s.length >= 3 ? s : null;
}

/** 从关系边推导词团：按类型分组后取连通分量 */
function linkClusters(bookId, words) {
  const links = getLinks(bookId);
  const wordIds = new Set(words.map((w) => w.id));
  const byType = new Map();
  for (const l of links) {
    if (!wordIds.has(l.a) || !wordIds.has(l.b)) continue;
    if (!byType.has(l.type)) byType.set(l.type, []);
    byType.get(l.type).push(l);
  }

  const out = [];
  for (const [type, list] of byType) {
    const adj = new Map();
    for (const l of list) {
      if (!adj.has(l.a)) adj.set(l.a, new Set());
      if (!adj.has(l.b)) adj.set(l.b, new Set());
      adj.get(l.a).add(l.b);
      adj.get(l.b).add(l.a);
    }
    const seen = new Set();
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const nb of adj.get(cur) || []) {
          if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
        }
      }
      if (comp.length >= 2) out.push({ type, memberIds: comp });
    }
  }
  return out;
}

/** 从形态推导变式词团 */
function morphClusters(words) {
  const groups = new Map();
  for (const w of words) {
    if (!/^[a-zA-Z]+$/.test(w.term)) continue;
    const st = morphStem(w.term);
    if (!st) continue;
    if (!groups.has(st)) groups.set(st, []);
    groups.get(st).push(w);
  }
  const out = [];
  for (const [stem, list] of groups) {
    if (list.length < 2) continue;
    // 必须有词确实只是 st 加上后缀，避免把不相关的词凑在一起
    const real = list.filter((w) => {
      const t = w.term.toLowerCase();
      return t !== stem && t.startsWith(stem) && t.length - stem.length <= 5;
    });
    if (real.length < 2) continue;
    out.push({ type: 'variant', memberIds: real.map((w) => w.id), stem });
  }
  return out;
}

/** 生成建议词团（不写入数据）。返回 [{name, kind, memberIds}] */
export function deriveClusters(bookId) {
  const items = getEntriesOfBook(bookId);
  const words = items.map((x) => x.word);
  if (!words.length) return [];

  const result = [];
  const seenSets = new Set();
  const push = (name, kind, memberIds) => {
    const key = [...memberIds].sort().join('|');
    if (seenSets.has(key)) return;
    seenSets.add(key);
    result.push({ name, kind, memberIds });
  };

  const byId = new Map(words.map((w) => [w.id, w]));

  // 1) 关系连通分量优先
  for (const c of linkClusters(bookId, words)) {
    const degree = new Map();
    for (const id of c.memberIds) degree.set(id, 0);
    for (const l of getLinks(bookId)) {
      if (c.memberIds.includes(l.a) && c.memberIds.includes(l.b)) {
        degree.set(l.a, (degree.get(l.a) || 0) + 1);
        degree.set(l.b, (degree.get(l.b) || 0) + 1);
      }
    }
    let top = c.memberIds[0];
    let best = -1;
    for (const [id, d] of degree) if (d > best) { best = d; top = id; }
    const label = REL_TYPES[c.type]?.label || '关联';
    push(`${byId.get(top)?.term || ''} 的${label}`, c.type, c.memberIds);
  }

  // 2) 形态变式补充
  for (const c of morphClusters(words)) {
    push(`${c.stem} 变式`, 'variant', c.memberIds);
  }

  return result;
}
