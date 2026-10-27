/* 词典查询：音标 / 发音 / 词性 / 英文释义，以及中文翻译 */

const CACHE_KEY = 'vn.dict.cache.v1';
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30;

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { cache = {}; }

let cacheDirty = false;
setInterval(() => {
  if (!cacheDirty) return;
  cacheDirty = false;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* 忽略 */ }
}, 5000);

/** Free Dictionary API —— 无需 Key，提供音标、音频、词性、英文释义、同义反义 */
export async function fetchDictionary(term) {
  const k = term.toLowerCase();
  const hit = cache[k];
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const res = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(k)}`
  );
  if (!res.ok) {
    if (res.status === 404) {
      const data = { found: false };
      cache[k] = { at: Date.now(), data };
      cacheDirty = true;
      return data;
    }
    throw new Error(`词典查询失败 (${res.status})`);
  }
  const json = await res.json();
  const data = normalizeDictionary(json, term);
  cache[k] = { at: Date.now(), data };
  cacheDirty = true;
  return data;
}

function normalizeDictionary(json, term) {
  const first = json?.[0];
  if (!first) return { found: false };

  let phonetic = '';
  let audio = '';
  for (const p of first.phonetics || []) {
    if (p.text && !phonetic) phonetic = p.text;
    if (p.audio && !audio) audio = p.audio;
  }

  const pos = [];
  const seen = new Set();
  for (const entry of json) {
    for (const m of entry.meanings || []) {
      const tag = m.partOfSpeech || '';
      let bucket = pos.find((p) => p.tag === tag);
      if (!bucket) {
        bucket = { tag, defs: [], synonyms: [], antonyms: [] };
        pos.push(bucket);
      }
      for (const d of m.definitions || []) {
        if (bucket.defs.length < 3 && d.definition) {
          bucket.defs.push({ definition: d.definition, example: d.example || '' });
        }
      }
      for (const s of m.synonyms || []) if (!bucket.synonyms.includes(s)) bucket.synonyms.push(s);
      for (const s of m.antonyms || []) if (!bucket.antonyms.includes(s)) bucket.antonyms.push(s);
      seen.add(tag);
    }
  }

  return {
    found: true,
    term: first.word || term,
    phonetic,
    audio,
    pos,
  };
}

/** 只接受像中文的短释义，避免接口异常时把 JSON 之类的东西写进释义 */
export function sanitizeZh(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length > 60) return '';
  if (t.startsWith('{') || t.startsWith('[')) return '';
  const cjk = (t.match(/[一-鿿]/g) || []).length;
  if (!cjk) return '';
  if (cjk / t.length < 0.3) return '';
  return t;
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
    return sanitizeZh(t);
  } catch {
    return '';
  }
}

/** 组合：一次性取回一个单词的全部展示信息 */
export async function enrichTerm(term, { aiClient = null, useDictApi = true } = {}) {
  let dict = { found: false, phonetic: '', audio: '', pos: [] };
  if (useDictApi) {
    try { dict = await fetchDictionary(term); } catch (e) { console.warn('[dict]', e); }
  }
  const context = (dict.pos || [])
    .slice(0, 3)
    .map((p) => `${p.tag}: ${p.defs[0]?.definition || ''}`)
    .join('\n');

  let meaningZh = '';
  if (aiClient) {
    try {
      meaningZh = sanitizeZh(await aiClient.translateWord(term, context, dict.pos));
    } catch (e) {
      console.warn('[enrich] AI 释义失败', e);
    }
  }
  if (!meaningZh) {
    meaningZh = await myMemoryTranslate(term);
  }

  return {
    phonetic: dict.phonetic || '',
    audio: dict.audio || '',
    pos: dict.pos || [],
    meaningZh,
    enrichState: 'done',
  };
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
