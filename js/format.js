/* 展示格式化：词性缩写、权重样式 */

const POS_ABBR = {
  noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.',
  interjection: 'int.', preposition: 'prep.', conjunction: 'conj.',
  pronoun: 'pron.', determiner: 'det.', numeral: 'num.', exclamation: 'int.',
  'auxiliary verb': 'aux.', article: 'art.', particle: 'part.', phrase: 'phr.',
};

export function posAbbr(tag) {
  const t = String(tag || '').toLowerCase().trim();
  return POS_ABBR[t] || (t ? `${t.slice(0, 3)}.` : '');
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
