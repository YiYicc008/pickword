/* 添加单词：自动获取词典信息 + 手动/AI 选择多个单词本 */

import { getBooks, addTerm, updateWord, getWordByTerm, getBooksOfWord, getSettings } from './store.js';
import { icon, toast, openModal } from './ui.js';
import { el, debounce, looksEnglish } from './util.js';
import { enrichTerm, speak } from './dict.js';
import { hasAI, classifyWord, translateWord, translateSenses, describeWord } from './ai.js';
import { vs } from './viewstate.js';
import { posAbbr, sensesSig } from './format.js';

const aiClient = () =>
  hasAI()
    ? { translateWord, translateSenses, describeWord }
    : null;

const splitTerms = (raw) =>
  String(raw || '')
    .split(/[\n,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function openAddWordDialog({ preselectBookId = null, initialTerm = '' } = {}) {
  const books = getBooks();
  const selected = new Set();
  if (preselectBookId) selected.add(preselectBookId);

  let preview = null;
  let previewTerm = '';
  let enrichSeq = 0;
  const enrichCache = new Map();

  const body = el('div', {});

  /* 输入 */
  const input = el('input', {
    class: 'text-input big',
    placeholder: '输入单词，多个可用逗号或换行分隔',
    value: initialTerm,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  const inputField = el('div', { class: 'field' });
  inputField.appendChild(input);
  body.appendChild(inputField);

  /* 预览 */
  const previewHost = el('div', { style: 'margin-bottom:18px' });
  body.appendChild(previewHost);

  /* 单词本选择 */
  const bookField = el('div', { class: 'field' });
  const labelRow = el('div', { class: 'field-label' });
  labelRow.appendChild(el('span', { text: '放入哪些单词本' }));

  const aiBtn = el('button', {
    class: 'btn btn-ai',
    style: 'padding:5px 11px;font-size:12px',
    title: hasAI() ? '让 AI 判断该归入哪些单词本' : '请先在设置中配置 AI',
  });
  aiBtn.innerHTML = icon('sparkles', 13) + '<span>AI 智能分类</span>';
  if (!hasAI()) aiBtn.style.opacity = '0.55';
  labelRow.appendChild(aiBtn);
  bookField.appendChild(labelRow);

  const chips = el('div', { class: 'book-chips' });
  bookField.appendChild(chips);
  const hint = el('div', { class: 'field-hint', text: '可多选。选中多个时，单词会同时进入每一个单词本，各自独立计数。' });
  bookField.appendChild(hint);
  body.appendChild(bookField);

  /* 渲染 chips */
  const aiPicked = new Set();
  function renderChips() {
    chips.innerHTML = '';
    for (const b of books) {
      const on = selected.has(b.id);
      const chip = el('button', {
        class: `book-chip${on ? ' on' : ''}`,
        style: `--chip-color:${b.color};--chip-bg:${b.color}1c`,
        'aria-pressed': String(on),
      });
      chip.appendChild(el('span', { text: b.name }));
      if (aiPicked.has(b.id) && on) chip.appendChild(el('span', { class: 'ai-mark', text: 'AI' }));
      chip.addEventListener('click', () => {
        if (selected.has(b.id)) { selected.delete(b.id); aiPicked.delete(b.id); }
        else selected.add(b.id);
        renderChips();
      });
      chips.appendChild(chip);
    }
    const note = getWordByTerm(currentSingle()) ;
    hint.textContent = note && selected.size
      ? '该单词已存在，此次记录会让它在所选每个单词本中的权重 +1。'
      : '可多选。选中多个时，单词会同时进入每一个单词本，各自独立计数。';
  }

  function currentSingle() {
    const parts = splitTerms(input.value);
    return parts.length === 1 ? parts[0] : '';
  }

  /* 预览渲染 */
  function renderPreview(state) {
    previewHost.innerHTML = '';
    const term = previewTerm;
    if (!term) return;

    const card = el('div', { class: 'preview-card' });
    const head = el('div', { class: 'preview-head' });
    head.appendChild(el('span', { class: 'preview-term', text: term }));
    if (state?.phonetic) head.appendChild(el('span', { class: 'preview-phonetic', text: state.phonetic }));

    if (state?.phonetic || state?.audio) {
      const sp = el('button', { class: 'speak-btn', title: '发音' });
      sp.innerHTML = icon('volume', 14);
      sp.addEventListener('click', () => {
        if (!(state.audio && speakAudio(state.audio))) speak(term, getSettings().ttsRate);
      });
      head.appendChild(sp);
    }
    card.appendChild(head);

    if (state?.senses?.length) {
      const senseWrap = el('div', { class: 'preview-senses' });
      for (const s of state.senses.slice(0, 3)) {
        const row = el('div', { class: 'preview-sense' });
        const ab = posAbbr(s.pos);
        if (ab) row.appendChild(el('span', { class: 'pos-tag', text: ab }));
        // 中文没取到时不把英文释义塞进来，免得看起来像「已经查到了中文」
        row.appendChild(el('span', { class: 'preview-sense-zh', text: s.zh || '' }));
        if (s.zh) senseWrap.appendChild(row);
      }
      if (senseWrap.children.length) card.appendChild(senseWrap);
      else card.appendChild(el('div', { class: 'preview-state', text: '中文释义暂时没取到（翻译接口限流），可稍后点详情里的「重新获取」' }));
    } else if (state?.pos?.length) {
      const posWrap = el('div', { class: 'preview-pos' });
      for (const p of state.pos.slice(0, 5)) {
        posWrap.appendChild(el('span', { class: 'pos-tag', text: posAbbr(p.tag) }));
      }
      card.appendChild(posWrap);
    }
    if (!state?.senses?.length && state?.meaningZh) {
      card.appendChild(el('div', { class: 'preview-meaning', text: state.meaningZh }));
    }

    if (state === 'loading') {
      card.appendChild(el('div', { class: 'preview-state loading', text: '正在获取音标与释义' }));
    } else if (state === 'none') {
      card.appendChild(el('div', { class: 'preview-state', text: '未查到词典信息，可稍后手动补充释义' }));
    } else if (state === 'off') {
      card.appendChild(el('div', { class: 'preview-state', text: '已关闭自动释义，可添加后在详情里补充' }));
    }
    previewHost.appendChild(card);
  }

  function speakAudio(url) {
    try {
      new Audio(url).play().catch(() => {});
      return true;
    } catch { return false; }
  }

  /* 自动补全信息 */
  const runEnrich = debounce(async () => {
    const parts = splitTerms(input.value);
    if (parts.length !== 1) {
      previewTerm = '';
      previewHost.innerHTML = '';
      if (parts.length > 1) {
        previewHost.appendChild(el('div', {
          class: 'preview-state',
          style: 'font-size:13px;color:var(--ink-3);padding:4px 2px',
          text: `将一次录入 ${parts.length} 个单词`,
        }));
      }
      return;
    }
    const term = parts[0];
    previewTerm = term;
    const s = getSettings();
    if (!s.autoEnrich) { renderPreview('off'); return; }
    if (!looksEnglish(term)) { renderPreview('none'); return; }

    if (enrichCache.has(term.toLowerCase())) {
      const cached = enrichCache.get(term.toLowerCase());
      if (cached.pending) renderPreview('loading');
      else renderPreview(cached.data);
      return;
    }

    const seq = ++enrichSeq;
    renderPreview('loading');

    const promise = enrichTerm(term, { aiClient: aiClient(), useDictApi: true })
      .then((data) => {
        if (seq === enrichSeq) {
          const found = data.phonetic || data.pos?.length || data.senses?.length || data.meaningZh;
          renderPreview(found ? data : 'none');
        }
        enrichCache.set(term.toLowerCase(), { data });
        return data;
      })
      .catch((e) => {
        console.warn('[add] 补全失败', e);
        if (seq === enrichSeq) renderPreview('none');
        return null;
      });
    enrichCache.set(term.toLowerCase(), { pending: true, promise });
  }, 480);

  input.addEventListener('input', () => { runEnrich(); renderChips(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
  });

  /* AI 分类 */
  aiBtn.addEventListener('click', async () => {
    if (!hasAI()) {
      toast('请先在「设置 → AI 服务」中填入 API Key', 'error', 3000);
      return;
    }
    const term = currentSingle();
    if (!term) { toast('AI 分类一次处理一个单词，请只输入一个', 'error'); return; }
    aiBtn.disabled = true;
    const old = aiBtn.innerHTML;
    aiBtn.innerHTML = '<span>判断中…</span>';
    try {
      const ids = await classifyWord(term, books);
      if (!ids.length) { toast('AI 认为暂不适合归入现有单词本，可手动选择', 'default', 3000); return; }
      selected.clear();
      aiPicked.clear();
      for (const id of ids) { selected.add(id); aiPicked.add(id); }
      renderChips();
      toast(`AI 建议归入 ${ids.length} 个单词本`, 'success');
    } catch (e) {
      toast(`AI 分类失败：${String(e.message || e).slice(0, 50)}`, 'error', 3600);
    } finally {
      aiBtn.innerHTML = old;
      aiBtn.disabled = false;
    }
  });

  /* 底部按钮 */
  const foot = el('div', { style: 'display:flex;gap:9px;width:100%;align-items:center' });
  const countLine = el('span', { style: 'font-size:12.5px;color:var(--ink-3)' });
  const cancel = el('button', { class: 'btn btn-quiet', text: '取消' });
  const ok = el('button', { class: 'btn btn-primary' });
  ok.innerHTML = icon('plus', 16) + '<span>添加</span>';
  cancel.addEventListener('click', () => ref.close());
  ok.addEventListener('click', submit);
  foot.append(countLine, el('div', { class: 'spacer', style: 'flex:1' }), cancel, ok);

  const ref = openModal({
    title: '添加单词',
    subtitle: '自动获取音标、发音、词性与中文释义',
    body, footer: foot,
  });

  input.addEventListener('input', () => {
    const n = splitTerms(input.value).length;
    countLine.textContent = n > 1 ? `${n} 个单词` : '';
  });

  /* 提交 */
  async function submit() {
    const parts = splitTerms(input.value);
    if (!parts.length) { toast('请先输入单词', 'error'); input.focus(); return; }
    if (!selected.size) { toast('请至少选择一个单词本', 'error'); return; }

    const ids = [...selected];
    const created = [];
    for (const term of parts) {
      const res = addTerm(term, ids);
      if (!res) continue;
      created.push(res);

      // 若预览数据已就绪，补写进去
      const cached = enrichCache.get(term.toLowerCase());
      const apply = (data) => {
        if (!data) return;
        updateWord(res.word.id, {
          phonetic: data.phonetic || res.word.phonetic,
          audio: data.audio || res.word.audio,
          pos: data.pos?.length ? data.pos : res.word.pos,
          senses: data.senses?.length ? data.senses : res.word.senses,
          meaningZh: data.meaningZh || res.word.meaningZh,
          enrichState: data.enrichState || 'done',
          // 记下「词典/AI 给的原始顺序」，用户把卡片改回这个顺序就算没改过
          autoSig: sensesSig(data.senses || []),
        });
      };
      if (cached?.data) apply(cached.data);
      else if (cached?.pending) cached.promise.then(apply).catch(() => {});
      else if (getSettings().autoEnrich && looksEnglish(term)) {
        enrichTerm(term, { aiClient: aiClient(), useDictApi: true }).then(apply).catch(() => {});
      }
    }

    if (!created.length) { toast('添加失败', 'error'); return; }

    const first = created[0].word;
    vs.highlightId = first.id;
    ref.close();

    const names = ids.map((id) => books.find((b) => b.id === id)?.name).filter(Boolean);
    if (parts.length === 1) {
      const w = created[0].results;
      const upgraded = w.filter((r) => !r.isNew);
      if (upgraded.length) {
        toast(`「${first.term}」权重 +1（${names.join('、')}）`, 'success', 2400);
      } else {
        toast(`已加入 ${names.length} 个单词本`, 'success', 2000);
      }
    } else {
      toast(`已录入 ${created.length} 个单词`, 'success');
    }
    window.dispatchEvent(new CustomEvent('vn:data-changed'));
  }

  // 初始
  renderChips();
  if (initialTerm) runEnrich();
  setTimeout(() => { input.focus(); input.select(); }, 80);
}
