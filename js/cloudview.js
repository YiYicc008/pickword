/* 词云视图：节点云 / 词团 / 关系 */

import {
  getBook, getWord, getEntry, getEntriesOfBook, getLinks, getClusters, getClouds,
  createCluster, updateCluster, deleteCluster, createCloud, updateCloud, deleteCloud,
  applyAutoClusters, replaceLinksFor, addLink, adjustWeight, removeEntry,
  REL_TYPES, CLUSTER_COLORS, getSettings, toggleClusterMember,
} from './store.js';
import { icon, toast, openModal, confirmDialog, promptDialog } from './ui.js';
import { el, looksEnglish } from './util.js';
import { WordCloud } from './graph.js';
import { deriveClusters } from './cluster.js';
import { hasAI, buildRelations } from './ai.js';
import { vs } from './viewstate.js';
import { openWordDetail } from './views.js';
import { posAbbr, posClass, weightClass } from './format.js';
import { speak, playAudio } from './dict.js';

const NONE_ID = '__unclustered__';
const NONE_COLOR = '#b7ae9f';
let current = null;
let selId = null;

/* ==================== 入口 ==================== */

export function renderCloudView(host) {
  if (current) { try { current.destroy(); } catch { /* noop */ } current = null; }
  host.innerHTML = '';

  const book = getBook(vs.bookId);
  if (!book) return;
  const entries = getEntriesOfBook(book.id);

  if (vs.cloudId && !getClouds(book.id).some((c) => c.id === vs.cloudId)) vs.cloudId = null;

  const root = el('div', { class: 'cloud-view' });

  if (!entries.length) {
    root.appendChild(cloudEmpty(
      '这个单词本还没有词。',
      '先添加几个单词，它们会以节点的形式出现在这里。',
      '去添加单词',
      () => openAddWord('cloud')
    ));
    host.appendChild(root);
    return;
  }

  /* ---------- 顶部：词云切换 ---------- */
  const bar = el('div', { class: 'cloud-bar' });
  const cloudRow = el('div', { class: 'cloud-chips' });
  const clouds = getClouds(book.id);

  const mkCloudChip = (id, name, count) => {
    const on = (vs.cloudId || null) === id;
    const chip = el('button', { class: `cloud-chip${on ? ' on' : ''}` });
    chip.append(el('span', { class: 'cloud-chip-name', text: name }));
    chip.appendChild(el('span', { class: 'cloud-chip-count', text: String(count) }));
    chip.addEventListener('click', () => { vs.cloudId = id; rebuild(); });
    return chip;
  };
  cloudRow.appendChild(mkCloudChip(null, '全部', bookStatsCount(book.id)));
  for (const c of clouds) cloudRow.appendChild(mkCloudChip(c.id, c.name, c.clusterIds.length));
  bar.appendChild(cloudRow);

  const tools = el('div', { class: 'cloud-tools' });
  const btnOrganize = ghostBtn('整理词团', 'layers', () => autoOrganize(book.id));
  const btnAI = ghostBtn('AI 生成关联', 'sparkles', () => aiRelations(book.id));
  const btnManage = ghostBtn('词团 / 词云', 'settings', () => openClusterManager(book.id));
  if (!hasAI()) btnAI.classList.add('dim');
  const btnFit = ghostBtn(null, 'maximize', () => current?.fit());
  btnFit.title = '适应窗口';
  const btnIn = ghostBtn(null, 'zoomIn', () => current?.zoomTo(1.25));
  btnIn.title = '放大';
  const btnOut = ghostBtn(null, 'x', () => current?.zoomTo(0.8));
  btnOut.title = '缩小';
  tools.append(btnOrganize, btnAI, btnManage, el('span', { class: 'cloud-sep' }), btnOut, btnIn, btnFit);
  bar.appendChild(tools);
  root.appendChild(bar);

  /* ---------- 图例：词团 ---------- */
  const legend = el('div', { class: 'legend-row' });
  root.appendChild(legend);

  /* ---------- 画布 ---------- */
  const wrap = el('div', { class: 'cloud-canvas' });
  const stage = el('div', { class: 'cloud-stage' });
  wrap.appendChild(stage);

  const detail = el('div', { class: 'node-detail hidden' });
  wrap.appendChild(detail);

  const hint = el('div', { class: 'cloud-hint' });
  hint.innerHTML = `${icon('info', 12)}<span>拖拽平移 · 滚轮缩放 · 点击节点查看单词 · 彩色圆环表示该词同时属于几个词团</span>`;
  wrap.appendChild(hint);

  root.appendChild(wrap);
  host.appendChild(root);

  const wc = new WordCloud(stage);
  current = wc;
  wc.onSelect = (id) => { selId = id; paintDetail(id); };

  /* ---------- 数据 ---------- */
  function scopeClusters() {
    const all = getClusters(book.id);
    if (!vs.cloudId) return all;
    const cw = getClouds(book.id).find((c) => c.id === vs.cloudId);
    if (!cw) return all;
    const ids = new Set(cw.clusterIds || []);
    return all.filter((c) => ids.has(c.id));
  }

  function build() {
    const scoped = scopeClusters();
    const allClusters = getClusters(book.id);
    const scopedIds = new Set(scoped.map((c) => c.id));

    const nodes = [];
    for (const { entry, word } of entries) {
      const mine = allClusters.filter((c) => (c.memberIds || []).includes(word.id));
      const mineInScope = mine.filter((c) => scopedIds.has(c.id));
      if (mine.length === 0) {
        if (vs.cloudId) continue; // 指定词云时只显示已归团的词
      } else if (mineInScope.length === 0) {
        continue;
      }
      const visibleClusters = mineInScope.filter((c) => !vs.hiddenClusters.has(c.id));
      if (mine.length > 0 && visibleClusters.length === 0) continue;
      nodes.push({
        id: word.id,
        term: word.term,
        label: word.term,
        weight: entry.weight,
        phonetic: word.phonetic || '',
        clusterIds: mineInScope.map((c) => c.id),
      });
    }

    const idSet = new Set(nodes.map((n) => n.id));
    const links = getLinks(book.id).filter((l) => idSet.has(l.a) && idSet.has(l.b));

    const clusters = scoped
      .filter((c) => (c.memberIds || []).some((m) => idSet.has(m)))
      .map((c) => ({ ...c, memberIds: c.memberIds.filter((m) => idSet.has(m)) }));

    // 未归属虚拟词团
    if (!vs.cloudId) {
      const clustered = new Set();
      for (const c of allClusters) for (const m of c.memberIds || []) clustered.add(m);
      const lonely = nodes.filter((n) => !clustered.has(n.id)).map((n) => n.id);
      if (lonely.length) {
        clusters.push({
          id: NONE_ID, name: `未归属（${lonely.length}）`, color: NONE_COLOR, memberIds: lonely, virtual: true,
        });
        for (const n of nodes) if (lonely.includes(n.id)) n.clusterIds = [...(n.clusterIds || []), NONE_ID];
      }
    }
    return { nodes, links, clusters };
  }

  function paintLegend(clusters) {
    legend.innerHTML = '';
    if (!clusters.length) {
      legend.appendChild(el('span', { class: 'legend-empty', text: '还没有词团。点击「整理词团」按词形与关系自动分组，或手动创建。' }));
    }
    for (const c of clusters) {
      const hidden = vs.hiddenClusters.has(c.id);
      const chip = el('button', {
        class: `legend-chip${hidden ? ' off' : ''}`,
        style: `--c:${c.color || NONE_COLOR}`,
        title: hidden ? '点击显示' : '点击隐藏',
      });
      chip.appendChild(el('span', { class: 'legend-dot' }));
      chip.appendChild(el('span', { class: 'legend-name', text: c.name }));
      chip.appendChild(el('span', { class: 'legend-count', text: String(c.memberIds.length) }));
      chip.addEventListener('click', () => {
        if (vs.hiddenClusters.has(c.id)) vs.hiddenClusters.delete(c.id);
        else vs.hiddenClusters.add(c.id);
        rebuild();
      });
      legend.appendChild(chip);
    }
    // 关系图例
    const types = new Set(getLinks(book.id).map((l) => l.type));
    if (types.size) {
      legend.appendChild(el('span', { class: 'legend-gap' }));
      for (const t of Object.keys(REL_TYPES)) {
        if (!types.has(t)) continue;
        const meta = REL_TYPES[t];
        const item = el('span', { class: 'rel-legend' });
        item.appendChild(el('span', { class: 'rel-line', style: `--c:${meta.color};--dash:${t === 'antonym' ? '3 3' : t === 'lookalike' ? '1 3' : '0'}` }));
        item.appendChild(el('span', { text: meta.label }));
        legend.appendChild(item);
      }
    }
  }

  function rebuild() {
    const data = build();
    wc.setData(data);
    paintLegend(data.clusters);
    if (selId && !data.nodes.some((n) => n.id === selId)) { selId = null; detail.classList.add('hidden'); }
    else if (selId) { wc.select(selId); }
    const stillHidden = [...vs.hiddenClusters].filter((id) => data.clusters.some((c) => c.id === id));
    wc.setHiddenClusters(new Set(stillHidden));
  }

  /* ---------- 节点详情卡 ---------- */
  function paintDetail(wordId) {
    detail.innerHTML = '';
    const word = getWord(wordId);
    const entry = getEntry(book.id, wordId);
    if (!word || !entry) { detail.classList.add('hidden'); return; }
    detail.classList.remove('hidden');

    const closeBtn = el('button', { class: 'detail-close', 'aria-label': '关闭' });
    closeBtn.innerHTML = icon('x', 14);
    closeBtn.addEventListener('click', () => { selId = null; detail.classList.add('hidden'); wc.select(null); });
    detail.appendChild(closeBtn);

    const head = el('div', { class: 'detail-head' });
    head.appendChild(el('span', { class: 'detail-term', text: word.term }));
    if (word.phonetic) head.appendChild(el('span', { class: 'detail-phonetic', text: word.phonetic }));
    const sp = el('button', { class: 'speak-btn', title: '发音' });
    sp.innerHTML = icon('volume', 13);
    sp.addEventListener('click', () => {
      if (word.audio && playAudio(word.audio)) return;
      speak(word.term, getSettings().ttsRate);
    });
    head.appendChild(sp);
    const wp = el('span', { class: `weight-pill ${weightClass(entry.weight)}`, text: String(entry.weight) });
    head.appendChild(wp);
    detail.appendChild(head);

    if (word.meaningZh) detail.appendChild(el('div', { class: 'detail-meaning', text: word.meaningZh }));
    if (word.pos?.length) {
      const line = el('div', { class: 'detail-pos' });
      for (const p of word.pos.slice(0, 4)) {
        const ab = posAbbr(p.tag);
        if (ab) line.appendChild(el('span', { class: `pos-tag ${posClass(ab)}`, text: ab }));
      }
      detail.appendChild(line);
    }

    const myClusters = getClusters(book.id).filter((c) => (c.memberIds || []).includes(word.id));
    if (myClusters.length) {
      const line = el('div', { class: 'detail-clusters' });
      for (const c of myClusters) {
        line.appendChild(el('span', { class: 'mini-cluster', style: `--c:${c.color}`, text: c.name }));
      }
      detail.appendChild(line);
    }

    const actions = el('div', { class: 'detail-actions' });
    const mk = (label, iconName, fn, cls = '') => {
      const b = el('button', { class: `mini-btn ${cls}` });
      b.innerHTML = icon(iconName, 13) + `<span>${label}</span>`;
      b.addEventListener('click', fn);
      return b;
    };
    actions.append(
      mk('权重 +1', 'plus', () => { adjustWeight(entry.id, 1); rebuild(); paintDetail(wordId); toast('权重 +1', 'success', 1200); }),
      mk('权重 −1', 'weight', () => {
        if (entry.weight <= 1) { toast('权重最小为 1', 'default', 1600); return; }
        adjustWeight(entry.id, -1); rebuild(); paintDetail(wordId);
      }),
      mk('详情', 'info', () => openWordDetail(wordId, book.id)),
      mk('移出', 'trash', async () => {
        if (!(await confirmDialog({ title: '移出单词', message: `将「${word.term}」从「${book.name}」移除？`, confirmText: '移出', danger: true }))) return;
        removeEntry(entry.id);
        selId = null; detail.classList.add('hidden');
        rebuild();
      }, 'danger')
    );
    detail.appendChild(actions);
  }

  /* ---------- 自动整理 ---------- */
  async function autoOrganize(bookId) {
    const list = deriveClusters(bookId);
    if (!list.length) {
      toast('没有发现可用来自动分组的词形或关系，可手动创建词团', 'default', 3200);
      return;
    }
    const ok = await confirmDialog({
      title: '整理词团',
      message: `将根据词形变式与单词关系自动生成 ${list.length} 个词团（会替换之前自动生成的词团，手动创建的不受影响）。`,
      confirmText: '开始整理',
    });
    if (!ok) return;

    let target = vs.cloudId;
    if (!target) {
      const cs = getClouds(bookId);
      if (cs.length) target = cs[0].id;
      else target = createCloud(bookId, '主词云').id;
    }
    applyAutoClusters(bookId, list);
    const made = getClusters(bookId).filter((c) => c.auto && !c.cloudId);
    for (const c of made) updateCluster(c.id, { cloudId: target });
    const cw = getClouds(bookId).find((c) => c.id === target);
    if (cw) {
      const all = getClusters(bookId).filter((c) => c.cloudId === target).map((c) => c.id);
      updateCloud(cw.id, { clusterIds: all });
    }
    vs.cloudId = target;
    rebuild();
    toast(`已整理出 ${made.length} 个词团`, 'success');
  }

  /* ---------- AI 生成关联 ---------- */
  async function aiRelations(bookId) {
    if (!hasAI()) {
      toast('请先在「设置 → AI 服务」中填入 API Key', 'error', 3200);
      return;
    }
    const words = entries.map((e) => getWord(e.wordId)).filter((w) => w && looksEnglish(w.term));
    if (words.length < 2) { toast('至少需要两个英文单词', 'error'); return; }
    if (words.length > 120) { toast('单词过多（>120），请先精简或分本处理', 'error', 3200); return; }

    const ok = await confirmDialog({
      title: 'AI 生成关联',
      message: `将让 AI 分析「${book.name}」中 ${words.length} 个单词之间的关系（变式 / 同义 / 反义 / 形近），生成词团与连线。上次由 AI 生成的关联会被替换。`,
      confirmText: '开始分析',
    });
    if (!ok) return;

    toast('AI 正在分析单词关系，可能需要十几秒…', 'default', 3200);
    try {
      const links = await buildRelations(words);
      if (!links.length) { toast('AI 没有找到足够有把握的关系', 'default', 3000); return; }
      replaceLinksFor(words.map((w) => w.id), links, 'ai');

      // 按关系类型重建自动词团
      const list = deriveClusters(bookId);
      if (list.length) {
        let target = vs.cloudId || getClouds(bookId)[0]?.id;
        if (!target) target = createCloud(bookId, '主词云').id;
        applyAutoClusters(bookId, list);
        const made = getClusters(bookId).filter((c) => c.auto && !c.cloudId);
        for (const c of made) updateCluster(c.id, { cloudId: target });
        const cw = getClouds(bookId).find((c) => c.id === target);
        if (cw) updateCloud(cw.id, { clusterIds: getClusters(bookId).filter((c) => c.cloudId === target).map((c) => c.id) });
        vs.cloudId = target;
      }
      rebuild();
      toast(`已生成 ${links.length} 条关联`, 'success');
    } catch (e) {
      toast(`AI 分析失败：${String(e.message || e).slice(0, 60)}`, 'error', 4200);
    }
  }

  rebuild();
}

/* ==================== 小工具 ==================== */

function ghostBtn(label, iconName, fn) {
  const b = el('button', { class: 'btn btn-quiet btn-sm' });
  b.innerHTML = icon(iconName, 14) + (label ? `<span>${label}</span>` : '');
  b.addEventListener('click', fn);
  return b;
}

function bookStatsCount(bookId) {
  return getEntriesOfBook(bookId).length;
}

function cloudEmpty(title, text, ctaLabel, fn) {
  const wrap = el('div', { class: 'empty', style: 'margin-top:40px' });
  const art = el('div', { class: 'empty-mark' });
  art.innerHTML = `<svg viewBox="0 0 120 90" width="120" height="90" fill="none">
    <circle cx="34" cy="46" r="9" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="62" cy="28" r="7" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="82" cy="56" r="11" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="48" cy="70" r="6" stroke="currentColor" stroke-width="1.4"/>
    <path d="M42 42 56 32M69 32l9 17M40 53l5 12" stroke="currentColor" stroke-width="1.2" opacity=".55"/>
  </svg>`;
  wrap.append(art, el('h3', { text: title }), el('p', { text }));
  if (ctaLabel) {
    const b = el('button', { class: 'btn btn-primary', text: ctaLabel });
    b.addEventListener('click', fn);
    wrap.appendChild(b);
  }
  return wrap;
}

function openAddWord() {
  import('./entry.js').then((m) => m.openAddWordDialog({ preselectBookId: vs.bookId }));
}

/* ==================== 词团 / 词云管理 ==================== */

function openClusterManager(bookId) {
  const body = el('div', {});
  const foot = el('div', { style: 'display:flex;gap:9px;width:100%;justify-content:flex-end' });
  const done = el('button', { class: 'btn btn-quiet', text: '关闭' });
  const auto = el('button', { class: 'btn btn-primary' });
  auto.innerHTML = icon('layers', 15) + '<span>整理词团</span>';
  foot.append(auto, done);

  const ref = openModal({
    title: '词团与词云',
    subtitle: '词团 = 一组相互关联的单词；词云 = 多个词团组成的集合；同一个词团可以同时属于多个词云。',
    body, footer: foot, wide: true,
  });
  done.addEventListener('click', () => ref.close());

  let busy = false;
  auto.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      const list = deriveClusters(bookId);
      if (!list.length) { toast('没有可自动分组的词形或关系', 'default', 2600); return; }
      let target = vs.cloudId || getClouds(bookId)[0]?.id || createCloud(bookId, '主词云').id;
      applyAutoClusters(bookId, list);
      const made = getClusters(bookId).filter((c) => c.auto && !c.cloudId);
      for (const c of made) updateCluster(c.id, { cloudId: target });
      const cw = getClouds(bookId).find((c) => c.id === target);
      if (cw) updateCloud(cw.id, { clusterIds: getClusters(bookId).filter((c) => c.cloudId === target).map((c) => c.id) });
      paint();
      window.dispatchEvent(new CustomEvent('vn:data-changed'));
      toast(`已生成 ${made.length} 个词团`, 'success');
    } finally { busy = false; }
  });

  function paint() {
    body.innerHTML = '';
    const clouds = getClouds(bookId);
    const clusters = getClusters(bookId);
    const total = getEntriesOfBook(bookId).length;

    /* 词云 */
    const cloudSec = el('div', { class: 'mgr-section' });
    const head = el('div', { class: 'mgr-head' });
    head.appendChild(el('h3', { text: `词云（${clouds.length}）` }));
    const addCloud = el('button', { class: 'btn btn-quiet btn-sm' });
    addCloud.innerHTML = icon('plus', 13) + '<span>新建词云</span>';
    addCloud.addEventListener('click', async () => {
      const name = await promptDialog({ title: '新建词云', placeholder: '例如：动词变化 / 雅思核心', confirmText: '创建' });
      if (!name) return;
      const cw = createCloud(bookId, name);
      paint();
      window.dispatchEvent(new CustomEvent('vn:data-changed'));
      toast(`已创建词云「${cw.name}」`, 'success');
    });
    head.appendChild(addCloud);
    cloudSec.appendChild(head);

    if (!clouds.length) {
      cloudSec.appendChild(el('p', { class: 'mgr-empty', text: '还没有词云。一个词云可以容纳多个词团；一个单词本可以有多个词云。' }));
    }
    for (const cw of clouds) {
      const row = el('div', { class: 'mgr-row' });
      const main = el('div', { class: 'mgr-row-main' });
      main.appendChild(el('span', { class: 'mgr-name', text: cw.name }));
      main.appendChild(el('span', { class: 'mgr-sub', text: `${(cw.clusterIds || []).length} 个词团` }));
      row.appendChild(main);

      const acts = el('div', { class: 'mgr-acts' });
      acts.appendChild(smallBtn('pencil', '重命名', async () => {
        const name = await promptDialog({ title: '重命名词云', value: cw.name, confirmText: '保存' });
        if (name) { updateCloud(cw.id, { name }); paint(); }
      }));
      acts.appendChild(smallBtn('trash', '删除', async () => {
        if (!(await confirmDialog({ title: '删除词云', message: `删除「${cw.name}」？其中的词团会保留，只是不再属于这个词云。`, confirmText: '删除', danger: true }))) return;
        deleteCloud(cw.id);
        if (vs.cloudId === cw.id) vs.cloudId = null;
        paint();
        window.dispatchEvent(new CustomEvent('vn:data-changed'));
      }));
      row.appendChild(acts);
      cloudSec.appendChild(row);
    }
    body.appendChild(cloudSec);

    /* 词团 */
    const clSec = el('div', { class: 'mgr-section' });
    const head2 = el('div', { class: 'mgr-head' });
    head2.appendChild(el('h3', { text: `词团（${clusters.length}）` }));
    const addCl = el('button', { class: 'btn btn-quiet btn-sm' });
    addCl.innerHTML = icon('plus', 13) + '<span>新建词团</span>';
    addCl.addEventListener('click', () => openClusterEditor(bookId, null, paint));
    head2.appendChild(addCl);
    clSec.appendChild(head2);

    if (!clusters.length) {
      clSec.appendChild(el('p', { class: 'mgr-empty', text: `全部 ${total} 个单词都还没有分组。点「整理词团」可按词形变式与关系自动分组。` }));
    }

    for (const c of clusters) {
      const row = el('div', { class: 'mgr-row' });
      const main = el('div', { class: 'mgr-row-main' });
      const dot = el('span', { class: 'mgr-dot', style: `--c:${c.color}` });
      main.appendChild(dot);
      main.appendChild(el('span', { class: 'mgr-name', text: c.name }));
      main.appendChild(el('span', { class: 'mgr-sub', text: `${(c.memberIds || []).length} 词${c.auto ? ' · 自动' : ''}` }));

      const belongs = clouds.filter((cw) => (cw.clusterIds || []).includes(c.id));
      if (belongs.length) {
        const tags = el('span', { class: 'mgr-tags' });
        for (const b of belongs) tags.appendChild(el('span', { class: 'mgr-tag', text: b.name }));
        main.appendChild(tags);
      }
      row.appendChild(main);

      const acts = el('div', { class: 'mgr-acts' });
      acts.appendChild(smallBtn('pencil', '编辑', () => openClusterEditor(bookId, c, paint)));
      acts.appendChild(smallBtn('trash', '删除', async () => {
        if (!(await confirmDialog({ title: '删除词团', message: `删除词团「${c.name}」？单词本身不会被删除。`, confirmText: '删除', danger: true }))) return;
        deleteCluster(c.id);
        paint();
        window.dispatchEvent(new CustomEvent('vn:data-changed'));
      }));
      row.appendChild(acts);
      clSec.appendChild(row);
    }
    body.appendChild(clSec);
  }

  paint();
}

function smallBtn(iconName, title, fn) {
  const b = el('button', { class: 'icon-btn sm', title, 'aria-label': title });
  b.innerHTML = icon(iconName, 14);
  b.addEventListener('click', fn);
  return b;
}

/* 词团编辑器 */
function openClusterEditor(bookId, cluster, done) {
  const clouds = getClouds(bookId);
  const words = getEntriesOfBook(bookId).map((x) => x.word).filter(Boolean);
  const members = new Set(cluster?.memberIds || []);
  const inClouds = new Set(clouds.filter((cw) => (cw.clusterIds || []).includes(cluster?.id)).map((cw) => cw.id));

  const body = el('div', {});

  const nameInput = el('input', {
    class: 'text-input', placeholder: '词团名称，例如：run 的变式 / 同义词', maxlength: '40',
    value: cluster?.name || '',
  });
  const nameField = el('div', { class: 'field' });
  nameField.appendChild(el('div', { class: 'field-label', text: '名称' }));
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  if (clouds.length) {
    const f = el('div', { class: 'field' });
    f.appendChild(el('div', { class: 'field-label', text: '属于哪些词云（可多选）' }));
    const chips = el('div', { class: 'book-chips' });
    for (const cw of clouds) {
      const on = inClouds.has(cw.id);
      const chip = el('button', { class: `book-chip${on ? ' on' : ''}`, style: '--chip-color:var(--blue);--chip-bg:#e8eef3' });
      chip.appendChild(el('span', { text: cw.name }));
      chip.addEventListener('click', () => {
        if (inClouds.has(cw.id)) inClouds.delete(cw.id); else inClouds.add(cw.id);
        chip.classList.toggle('on');
      });
      chips.appendChild(chip);
    }
    f.appendChild(chips);
    body.appendChild(f);
  }

  const mf = el('div', { class: 'field' });
  const mHead = el('div', { class: 'field-label' });
  const mCount = el('span', { text: `成员（${members.size}）` });
  mHead.appendChild(mCount);
  mf.appendChild(mHead);

  const search = el('input', { class: 'text-input', placeholder: '筛选单词…', style: 'margin-bottom:8px' });
  mf.appendChild(search);
  const list = el('div', { class: 'pick-list' });
  mf.appendChild(list);
  body.appendChild(mf);

  function paintList() {
    list.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    const shown = words
      .filter((w) => !q || w.term.toLowerCase().includes(q) || (w.meaningZh || '').includes(q))
      .sort((a, b) => Number(members.has(b.id)) - Number(members.has(a.id)) || a.term.localeCompare(b.term));
    if (!shown.length) {
      list.appendChild(el('div', { class: 'mgr-empty', text: '没有匹配的单词' }));
    }
    for (const w of shown.slice(0, 300)) {
      const on = members.has(w.id);
      const row = el('button', { class: `pick-row${on ? ' on' : ''}` });
      const box = el('span', { class: 'pick-box' });
      if (on) box.innerHTML = icon('check', 11);
      row.append(box, el('span', { class: 'pick-term', text: w.term }));
      if (w.meaningZh) row.appendChild(el('span', { class: 'pick-meaning', text: w.meaningZh }));
      row.addEventListener('click', () => {
        if (members.has(w.id)) members.delete(w.id); else members.add(w.id);
        mCount.textContent = `成员（${members.size}）`;
        row.classList.toggle('on');
        box.innerHTML = members.has(w.id) ? icon('check', 11) : '';
      });
      list.appendChild(row);
    }
  }
  search.addEventListener('input', paintList);
  paintList();

  const foot = el('div', { style: 'display:flex;gap:9px;width:100%;justify-content:flex-end' });
  const cancel = el('button', { class: 'btn btn-quiet', text: '取消' });
  const ok = el('button', { class: 'btn btn-primary', text: cluster ? '保存' : '创建' });
  foot.append(cancel, ok);

  const ref = openModal({ title: cluster ? '编辑词团' : '新建词团', body, footer: foot, wide: true });
  cancel.addEventListener('click', () => ref.close());
  ok.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('请填写词团名称', 'error'); nameInput.focus(); return; }
    const ids = [...members];

    let target = cluster;
    if (!target) {
      const created = createCluster(bookId, name, ids, 'custom');
      target = created;
    } else {
      updateCluster(cluster.id, { name, memberIds: ids, auto: false });
    }
    // 词云归属
    for (const cw of getClouds(bookId)) {
      const has = (cw.clusterIds || []).includes(target.id);
      const want = inClouds.has(cw.id);
      if (has === want) continue;
      const next = want
        ? [...(cw.clusterIds || []), target.id]
        : (cw.clusterIds || []).filter((id) => id !== target.id);
      updateCloud(cw.id, { clusterIds: next });
    }
    ref.close();
    done?.();
    window.dispatchEvent(new CustomEvent('vn:data-changed'));
    toast(cluster ? '词团已保存' : '词团已创建', 'success');
  });
}
