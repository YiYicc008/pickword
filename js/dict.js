/* 词典查询：音标 / 发音 / 词性 / 多义项中文释义 */

const CACHE_KEY = 'vn.dict.cache.v2';
const NOTFOUND_TTL = 10 * 60 * 1000;
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30;
const MAX_SENSES = 4;

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { cache = {}; }

let cacheDirty = false;
setInterval(() => {
  if (!cacheDirty) return;
  cacheDirty = false;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* 忽略 */ }
}, 5000);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Free Dictionary API —— 无需 Key，提供音标、音频、词性、英文释义、同义反义 */
export async function fetchDictionary(term, { force = false } = {}) {
  const k = String(term).toLowerCase();
  const hit = cache[k];
  // 「没收录」只缓存 10 分钟：接口抽风时的失败结论不该长期粘住
  if (hit && !force) {
    const ttl = hit.data && hit.data.found === false ? NOTFOUND_TTL : CACHE_TTL;
    if (Date.now() - hit.at < ttl) return hit.data;
  }

  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(k)}`;
  let lastErr = null;
  // 这个免费接口偶尔会拒绝并发/被限流，失败时重试一次，避免单词直接留空
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) {
        const data = { found: false, reason: 'notfound' };
        cache[k] = { at: Date.now(), data };
        cacheDirty = true;
        return data;
      }
      if (!res.ok) throw new Error(`词典查询失败 (${res.status})`);
      const json = await res.json();
      const data = normalizeDictionary(json, term);
      cache[k] = { at: Date.now(), data };
      cacheDirty = true;
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await wait(700);
    }
  }
  throw lastErr || new Error('词典查询失败');
}

function normalizeDictionary(json, term) {
  const entries = Array.isArray(json) ? json : [];
  if (!entries.length) return { found: false, reason: 'notfound' };

  // 音标与音频可能分散在任意一个条目里，全部扫一遍（原来只读第一条，导致部分单词没有音标）
  let phonetic = '';
  let audio = '';
  for (const e of entries) {
    if (!phonetic && e.phonetic) phonetic = e.phonetic;
    for (const p of e.phonetics || []) {
      if (!phonetic && p.text) phonetic = p.text;
      if (!audio && p.audio) audio = p.audio;
    }
  }

  const buckets = [];
  const byTag = new Map();
  for (const e of entries) {
    for (const m of e.meanings || []) {
      const tag = m.partOfSpeech || '';
      let bucket = byTag.get(tag);
      if (!bucket) {
        bucket = { tag, defs: [], synonyms: [], antonyms: [] };
        byTag.set(tag, bucket);
        buckets.push(bucket);
      }
      for (const d of m.definitions || []) {
        if (bucket.defs.length < 4 && d.definition) {
          bucket.defs.push({ definition: d.definition, example: d.example || '' });
        }
      }
      for (const s of m.synonyms || []) if (!bucket.synonyms.includes(s)) bucket.synonyms.push(s);
      for (const a of m.antonyms || []) if (!bucket.antonyms.includes(a)) bucket.antonyms.push(a);
    }
  }

  // 每个词性取一条代表释义作为「义项」，最多 4 条
  const senses = buckets.slice(0, MAX_SENSES).map((b) => ({
    pos: b.tag,
    def: b.defs[0]?.definition || '',
    example: b.defs[0]?.example || '',
    zh: '',
  }));

  return { found: true, term: entries[0].word || term, phonetic, audio, pos: buckets, senses };
}

/** 只接受像中文的短释义，避免接口异常时把 JSON 之类的东西写进释义 */
export function sanitizeZh(text, maxLen = 60) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length > maxLen) return '';
  if (t.startsWith('{') || t.startsWith('[')) return '';
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (!cjk) return '';
  if (cjk / t.length < 0.3) return '';
  return t;
}

function trimZh(text, maxLen = 22) {
  const t = text.replace(/^[，。；、\s]+/, '').trim();
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

/** 中文翻译：优先用 AI，其次用免费的 MyMemory 接口兜底 */
export async function translateToChinese(term, context = '', aiClient = null) {
  if (aiClient) {
    try {
      const out = sanitizeZh(await aiClient.translateWord(term, context));
      if (out) return out;
    } catch (e) {
      console.warn('[translate] AI 翻译失败，回退免费接口', e);
    }
  }
  return myMemoryTranslate(term);
}

async function myMemoryTranslate(text) {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`
    );
    if (!res.ok) return '';
    const json = await res.json();
    const t = String(json?.responseData?.translatedText || '').trim();
    if (!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(t)) return '';
    return sanitizeZh(t, 120);
  } catch {
    return '';
  }
}

/** MyMemory 会顺带给出一组同义译法，用来在没配 AI 时撑起「多个意思」 */
async function myMemoryGlosses(term) {
  const out = [];
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(term)}&langpair=en|zh-CN`
    );
    if (!res.ok) return out;
    const json = await res.json();
    const push = (v) => {
      const z = sanitizeZh(v, 24);
      if (z && !out.includes(z)) out.push(z);
    };
    push(json?.responseData?.translatedText);
    for (const m of json?.matches || []) {
      if (out.length >= MAX_SENSES) break;
      push(m.translation);
    }
  } catch { /* 忽略 */ }
  return out;
}

/**
 * 把英文释义翻译成中文义项。
 * 有 AI 时一次批量译完（更贴合词性与用法）；没有 AI 时用主译 + 释义句翻译兜底。
 */
export async function translateSenses(term, senses, aiClient = null) {
  const list = (senses || []).filter((s) => s && (s.def || s.pos));
  if (!list.length) return list;

  if (aiClient) {
    try {
      const arr = await aiClient.translateSenses(term, list);
      if (Array.isArray(arr)) {
        list.forEach((s, i) => {
          const z = sanitizeZh(arr[i] || '', 30);
          if (z) s.zh = z;
        });
      }
    } catch (e) {
      console.warn('[enrich] AI 义项翻译失败，回退免费接口', e);
    }
  }

  // 没有 AI 时的免费回退：首义项用词条主译（多义词表里第一个），
  // 其余义项各自翻译它自己的英文释义——按释义翻才不会有词性串味。
  if (list.some((s) => !s.zh)) {
    let glosses = [];
    try { glosses = await myMemoryGlosses(term); } catch (e) { glosses = []; }
    if (!list[0].zh && glosses[0]) list[0].zh = glosses[0];
    for (let i = 1; i < list.length; i++) {
      const s = list[i];
      if (s.zh || !s.def) continue;
      const sent = await myMemoryTranslate(s.def);
      const z = sanitizeZh(sent, 40);
      if (z) s.zh = trimZh(z);
    }
  }

  // 仍然缺中文的义项：翻译英文释义本身
  for (const s of list) {
    if (!s.zh && s.def) {
      const sent = await myMemoryTranslate(s.def);
      const z = sanitizeZh(sent, 40);
      if (z) s.zh = trimZh(z);
    }
  }

  return list;
}

/** 组合：一次性取回一个单词的全部展示信息 */
export async function enrichTerm(term, { aiClient = null, useDictApi = true, force = false } = {}) {
  let dict = { found: false, phonetic: '', audio: '', pos: [], senses: [] };
  let failed = false;
  if (useDictApi) {
    try {
      dict = await fetchDictionary(term, { force });
    } catch (e) {
      console.warn('[dict]', e);
      failed = true;
    }
  }

  let senses = Array.isArray(dict.senses) ? dict.senses : [];

  // 词典没收录 / 请求失败时，若配了 AI 就让它补词性、音标与义项
  if ((!senses.length || !dict.phonetic) && aiClient) {
    try {
      const filled = await aiClient.describeWord(term, dict.phonetic || '');
      if (filled) {
        if (!dict.phonetic && filled.phonetic) dict.phonetic = filled.phonetic;
        if (!senses.length && Array.isArray(filled.senses)) {
          senses = filled.senses.map((s) => ({ pos: s.pos || '', def: s.def || '', zh: s.zh || '', example: '' }));
        }
      }
    } catch (e) {
      console.warn('[enrich] AI 补全失败', e);
    }
  }

  if (senses.length) {
    senses = await translateSenses(term, senses, aiClient);
  }

  const meaningZh = senses.map((s) => s.zh).filter(Boolean).slice(0, 3).join('；');

  return {
    phonetic: dict.phonetic || '',
    audio: dict.audio || '',
    pos: dict.pos || [],
    senses,
    meaningZh,
    enrichState: failed ? 'failed' : senses.length ? 'done' : dict.found ? 'partial' : 'notfound',
  };
}

/** 判断一条单词记录是否还缺东西（用于「补全释义」按钮） */
export function missingInfo(word) {
  if (!word) return ['missing'];
  const gaps = [];
  const hasSense = (Array.isArray(word.senses) && word.senses.length) || word.meaningZh;
  if (!word.phonetic) gaps.push('phonetic');
  if (!hasSense) gaps.push('senses');
  if (!Array.isArray(word.pos) || !word.pos.length) gaps.push('pos');
  return gaps;
}

/** 浏览器内置语音合成 */
export function speak(term, rate = 0.9) {
  if (!('speechSynthesis' in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(term);
    u.lang = 'en-US';
    u.rate = rate;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((x) => /en[-_]US/i.test(x.lang) && /female|Samantha|Zira|Google US/i.test(x.name))
      || voices.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function playAudio(url) {
  if (!url) return false;
  try {
    const a = new Audio(url);
    a.play().catch(() => {});
    return true;
  } catch { return false; }
}
