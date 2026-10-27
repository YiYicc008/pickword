/* AI 能力：智能分类 / 中文释义 / 词团关系生成（兼容 DeepSeek、OpenAI 及任何 OpenAI 格式接口） */

import { getSettings } from './store.js';
import { normalizeTerm } from './util.js';

export const PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  moonshot: { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  custom: { label: '自定义', baseUrl: '', model: '' },
};

export function hasAI() {
  const s = getSettings();
  return Boolean(s.aiKey && s.aiBaseUrl && s.aiModel);
}

function endpoint() {
  const s = getSettings();
  const base = String(s.aiBaseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('尚未配置 AI 接口地址');
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

async function chat(messages, { json = false, temperature = 0.3, maxTokens = 900, timeout = 45000 } = {}) {
  const s = getSettings();
  if (!s.aiKey) throw new Error('尚未配置 AI Key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.aiKey}`,
      },
      body: JSON.stringify({
        model: s.aiModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI 接口返回 ${res.status}${body ? '：' + body.slice(0, 200) : ''}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 未返回内容');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** 从可能带 ```json 包裹的回复中解析 JSON */
export function parseJSON(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  const endArr = s.lastIndexOf(']');
  const endObj = s.lastIndexOf('}');
  const end = Math.max(endArr, endObj);
  if (end >= 0) s = s.slice(0, end + 1);
  try { return JSON.parse(s); } catch { return null; }
}

/* ---------------- 具体能力 ---------------- */

/** 需求 3：AI 智能分类 —— 判断一个单词应该归入哪些单词本 */
export async function classifyWord(term, books) {
  if (!books.length) return [];
  const list = books.map((b, i) => `${i}. ${b.name}`).join('\n');
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是一个英语词汇归类助手。根据单词的语义、词性、难度和使用场景，判断它应该被放进哪几个单词本。' +
          '只输出 JSON，格式为 {"books":[索引数字,...]}，可多选；若都不合适返回 {"books":[]}。不要输出任何解释。',
      },
      {
        role: 'user',
        content: `单词：${normalizeTerm(term)}\n\n候选单词本：\n${list}\n\n请给出归类结果。`,
      },
    ],
    { json: true, temperature: 0.1, maxTokens: 200 }
  );
  const parsed = parseJSON(raw);
  const idx = Array.isArray(parsed?.books) ? parsed.books : [];
  return idx
    .map((i) => books[Number(i)])
    .filter(Boolean)
    .map((b) => b.id);
}

/** 需求 4：中文释义（含词性精简版） */
export async function translateWord(term, context = '', pos = []) {
  const posHint = pos.length
    ? pos.slice(0, 3).map((p) => `${p.tag}: ${p.defs?.[0]?.definition || ''}`).join('\n')
    : context;
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是英汉词典编纂助手。给出该英语单词在当代英语中最常用的中文释义。' +
          '要求：简洁、地道的词典式表达；多个义项用「；」分隔；不超过 40 个汉字；' +
          '不要音标、不要英文、不要词性标注、不要引号、不要解释。只输出释义本身。',
      },
      {
        role: 'user',
        content: `单词：${normalizeTerm(term)}${posHint ? `\n英文释义参考：\n${posHint}` : ''}`,
      },
    ],
    { temperature: 0.2, maxTokens: 200 }
  );
  return String(raw || '').trim().replace(/^["「『]|["」』]$/g, '').trim();
}

/** 需求 6.2：为一批单词生成语义关系，用于词团/词云 */
export async function buildRelations(words) {
  const list = words.map((w, i) => `${i}. ${w.term}${w.meaningZh ? `（${w.meaningZh}）` : ''}`).join('\n');
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是英语词汇关系分析器。分析给定单词两两之间的关系，只输出 JSON：' +
          '{"links":[{"a":索引,"b":索引,"type":"variant|synonym|antonym|lookalike"}]}。' +
          'variant=同一词根/词形的不同变化（如 run/running/ran）；synonym=同义或近义；' +
          'antonym=反义；lookalike=拼写相近容易混淆。' +
          '只输出确有把握的关系，宁少勿滥；每个单词最多连 4 条边；不要输出解释。',
      },
      { role: 'user', content: `单词列表：\n${list}` },
    ],
    { json: true, temperature: 0.2, maxTokens: 1600, timeout: 90000 }
  );
  const parsed = parseJSON(raw);
  const links = Array.isArray(parsed?.links) ? parsed.links : [];
  const valid = ['variant', 'synonym', 'antonym', 'lookalike'];
  return links
    .map((l) => ({
      a: words[Number(l.a)]?.id,
      b: words[Number(l.b)]?.id,
      type: valid.includes(l.type) ? l.type : 'custom',
    }))
    .filter((l) => l.a && l.b && l.a !== l.b);
}

/** 把每个义项译成中文（一次批量，保持词性对应） */
export async function translateSenses(term, senses) {
  const list = senses.slice(0, 4);
  if (!list.length) return [];
  const lines = list
    .map((s, i) => `${i}. [${s.pos || '?'}] ${s.def || ''}`)
    .join('\n');
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是英汉词典编纂助手。为给定单词的每个英文义项各写一条中文释义。' +
          '要求：按输入顺序一一对应；每条是词典式短语，不超过 12 个汉字，多个近义说法用「、」连接；' +
          '不要音标、不要英文、不要词性标注、不要引号、不要序号、不要解释。' +
          '只输出 JSON：{"zh":["第一条","第二条",...]}',
      },
      {
        role: 'user',
        content: `单词：${normalizeTerm(term)}\n义项：\n${lines}`,
      },
    ],
    { json: true, temperature: 0.1, maxTokens: 400 }
  );
  const parsed = parseJSON(raw);
  return Array.isArray(parsed?.zh) ? parsed.zh.map((s) => String(s || '').trim()) : [];
}

/** 词典查不到时，让 AI 补齐音标与义项 */
export async function describeWord(term) {
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是权威英汉词典。为给定单词给出音标与常用义项。只输出 JSON：' +
          '{"phonetic":"/国际音标/","senses":[{"pos":"noun|verb|adjective|adverb|...","def":"简短英文释义","zh":"中文释义"}]}。' +
          '最多 4 个义项，按常用程度排序；不确定的字段留空字符串，不要编造。不要输出解释。',
      },
      { role: 'user', content: `单词：${normalizeTerm(term)}` },
    ],
    { json: true, temperature: 0.1, maxTokens: 500 }
  );
  const parsed = parseJSON(raw);
  if (!parsed) return null;
  const senses = Array.isArray(parsed.senses)
    ? parsed.senses
        .map((s) => ({ pos: String(s.pos || ''), def: String(s.def || ''), zh: String(s.zh || ''), example: '' }))
        .filter((s) => s.zh || s.def)
        .slice(0, 4)
    : [];
  return { phonetic: String(parsed.phonetic || ''), senses };
}

/**
 * 需求 3：基于本单词本已有词汇，让 AI 划分词团与词云。
 * 返回 { clouds: [{ name, clusters: [{ name, wordIds: [] }] }] }
 */
export async function buildClouds(words) {
  if (words.length < 2) return [];
  const list = words
    .map((w, i) => `${i}. ${w.term}${w.meaningZh ? `（${w.meaningZh}）` : ''}`)
    .join('\n');
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是英语词汇语义网络整理器。把给定单词组织成「词云—词团」两级结构。' +
          '词团=彼此关系紧密的一组词（同义/反义/同词根变体/拼写易混/同一主题）；词云=若干相关词团的集合。' +
          '要求：1~3 个词云；每个词云 2~5 个词团；每个词团 2~6 个单词；' +
          '同一个单词可以出现在多个词团里（用于体现重叠）；词团名与词云名用简短中文（不超过 8 字）。' +
          '只输出 JSON：{"clouds":[{"name":"词云名","clusters":[{"name":"词团名","words":[单词,...]}]}]}，' +
          'words 里必须使用输入列表中的原词，不要输出解释。',
      },
      { role: 'user', content: `单词列表：\n${list}` },
    ],
    { json: true, temperature: 0.3, maxTokens: 2000, timeout: 90000 }
  );
  const parsed = parseJSON(raw);
  const clouds = Array.isArray(parsed?.clouds) ? parsed.clouds : [];
  const byTerm = new Map(words.map((w) => [String(w.term).toLowerCase(), w.id]));
  return clouds
    .map((c) => {
      const clusters = (Array.isArray(c.clusters) ? c.clusters : [])
        .map((k) => {
          const ids = [];
          for (const t of Array.isArray(k.words) ? k.words : []) {
            const id = byTerm.get(String(t).toLowerCase());
            if (id && !ids.includes(id)) ids.push(id);
          }
          return { name: String(k.name || '').trim() || '未命名词团', wordIds: ids };
        })
        .filter((k) => k.wordIds.length >= 1);
      return { name: String(c.name || '').trim() || '词云', clusters };
    })
    .filter((c) => c.clusters.length);
}

/** 测试连接 */
export async function testConnection() {
  const raw = await chat(
    [{ role: 'user', content: '回复两个字：正常' }],
    { maxTokens: 20, temperature: 0 }
  );
  return String(raw).trim();
}
