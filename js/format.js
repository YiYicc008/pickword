/* 展示格式化：词性缩写、权重样式 */

const POS_ABBR = {
  noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.',
  interjection: 'int.', preposition: 'prep.', conjunction: 'conj.',
  pronoun: 'pron.', determiner: 'det.', numeral: 'num.', exclamation: 'int.',
  'auxiliary verb': 'aux.', article: 'art.', particle: 'part.', phrase: 'phr.',
};

/** 词典的完整词性 → 缩写；用户手填的缩写/中文原样返回 */
export function posAbbr(tag) {
  const t = String(tag || '').trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  if (POS_ABBR[lower]) return POS_ABBR[lower];
  if (/^[a-z]+\.?$/i.test(t)) return `${lower.replace(/\.+$/, '')}.`;
  return t;
}

/** 用户输入的缩写/中文 → 存储用的词性标签（认不出来就原样存） */
export function posTag(input) {
  const t = String(input || '').trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  const withDot = lower.endsWith('.') ? lower : `${lower}.`;
  for (const [tag, abbr] of Object.entries(POS_ABBR)) {
    if (abbr === withDot || tag === lower) return tag;
  }
  return t;
}

export function posClass(abbr) {
  const a = String(abbr || '').replace('.', '');
  return ['n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'det', 'art', 'num', 'int', 'aux', 'part', 'phr'].includes(a)
    ? a
    : 'other';
}

export function weightClass(w) {
  if (w >= 6) return 'w-max';
  if (w >= 1) return `w-${w}`;
  return 'w-1';
}
