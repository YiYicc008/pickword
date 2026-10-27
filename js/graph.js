/* 力导向词云引擎 —— 支持词团重叠、多词云、缩放拖拽
   节点=单词；边=词间关系；词团=关系聚簇（可重叠）；词云=词团的集合 */

const TAU = Math.PI * 2;

const TYPE_STYLE = {
  variant: { color: '#2f5d7c', rest: 112, strength: 0.055 },
  synonym: { color: '#3f7d5a', rest: 154, strength: 0.032 },
  antonym: { color: '#b8452f', rest: 172, strength: 0.026, dash: [5, 4] },
  lookalike: { color: '#c98a2e', rest: 104, strength: 0.045, dash: [2, 4] },
  custom: { color: '#8b8377', rest: 140, strength: 0.03 },
};

export class WordCloud {
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', '单词关系词云');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.nodes = [];
    this.links = [];
    this.clusters = [];
    this.nodeMap = new Map();

    this.transform = { x: 0, y: 0, k: 1 };
    this.alpha = 1;
    this.running = false;
    this.frame = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.selectedId = null;
    this.hoverId = null;
    this.hiddenClusters = new Set();

    this.onSelect = null;
    this.onHover = null;

    this._bindEvents();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(host);
    this.resize();
  }

  /* ---------------- 数据 ---------------- */

  setData({ nodes, links, clusters }) {
    const prev = this.nodeMap;
    this.clusters = clusters.map((c) => ({ ...c }));
    this._compact = this.w && this.w < 560 ? 0.78 : 1;
    this.nodes = nodes.map((n) => {
      const old = prev.get(n.id);
      return {
        ...n,
        x: old ? old.x : (Math.random() - 0.5) * 420,
        y: old ? old.y : (Math.random() - 0.5) * 320,
        vx: 0,
        vy: 0,
        r: (11 + Math.min(n.weight, 14) * 1.35) * (this._compact || 1),
      };
    });
    this.nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = links.filter((l) => this.nodeMap.has(l.a) && this.nodeMap.has(l.b));
    this.alpha = 1;

    // 先同步跑一轮预演：不依赖 requestAnimationFrame（后台标签页会被节流），
    // 一次性算到稳定布局，再交给动画做细微调整。
    this._warmup(260);
    this._stretchToAspect();
    if (this.w && this.h) this._fitNow();
    this._draw();

    this.alpha = Math.max(this.alpha, 0.18);
    this.start();
    this._needsFit = !(this.w && this.h);
  }

  setHiddenClusters(set) {
    this.hiddenClusters = new Set(set);
    this.alpha = Math.max(this.alpha, 0.25);
    this.start();
  }

  get visibleNodes() {
    return this.nodes.filter((n) => {
      if (!n.clusterIds || !n.clusterIds.length) return true;
      return n.clusterIds.some((c) => !this.hiddenClusters.has(c));
    });
  }

  select(id) {
    this.selectedId = id;
    this.onSelect?.(id);
    this._draw();
  }

  focus(id) {
    const n = this.nodeMap.get(id);
    if (!n) return;
    this.selectedId = id;
    this._animateTo(n.x, n.y, Math.max(this.transform.k, 1.15));
    this._draw();
  }

  /* ---------------- 尺寸 ---------------- */

  resize() {
    const rect = this.host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    if (!this._inited) {
      this._inited = true;
      this._stretchToAspect();
      this._fitNow();
    }
    this._draw();
  }

  /* ---------------- 物理模拟 ---------------- */

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.alpha *= 0.985;
      const energy = this._simulate();
      this._draw();
      if (this.alpha < 0.01 || energy < 0.02) {
        this.running = false;
        this._settle();
        this._draw();
        if (this._needsFit) { this._needsFit = false; this._fitNow(); this._draw(); }
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  _simulate() {
    const nodes = this.nodes;
    const n = nodes.length;
    if (!n) return 0;

    const alpha = this.alpha;
    const REPULSE = 2100;
    const MAX_FORCE = 70;

    // 斥力
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        if (d2 > 260000) continue;
        const d = Math.sqrt(d2);
        const f = (REPULSE * alpha) / d2;
        const ux = dx / d;
        const uy = dy / d;
        a.vx -= ux * f; a.vy -= uy * f;
        b.vx += ux * f; b.vy += uy * f;
      }
    }

    // 弹簧（关系边）
    for (const l of this.links) {
      const a = this.nodeMap.get(l.a);
      const b = this.nodeMap.get(l.b);
      if (!a || !b) continue;
      const st = TYPE_STYLE[l.type] || TYPE_STYLE.custom;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - st.rest) * st.strength * alpha;
      const ux = dx / d;
      const uy = dy / d;
      a.vx += ux * f; a.vy += uy * f;
      b.vx -= ux * f; b.vy -= uy * f;
    }

    // 词团内聚：把成员拉向词团质心，形成可辨认的团块
    for (const c of this.clusters) {
      if (this.hiddenClusters.has(c.id)) continue;
      const members = c.memberIds.map((id) => this.nodeMap.get(id)).filter(Boolean);
      if (members.length < 2) continue;
      let cx = 0, cy = 0;
      for (const m of members) { cx += m.x; cy += m.y; }
      cx /= members.length; cy /= members.length;
      const k = 0.020 * alpha;
      for (const m of members) {
        m.vx += (cx - m.x) * k;
        m.vy += (cy - m.y) * k;
      }
    }

    // 词团之间轻推，避免两个团糊成一团（重叠但可分辨）
    const cents = [];
    for (const c of this.clusters) {
      if (this.hiddenClusters.has(c.id)) continue;
      const ms = c.memberIds.map((id) => this.nodeMap.get(id)).filter(Boolean);
      if (!ms.length) continue;
      let cx0 = 0, cy0 = 0, rr = 0;
      for (const m of ms) { cx0 += m.x; cy0 += m.y; rr = Math.max(rr, m.r); }
      cents.push({ ms, cx: cx0 / ms.length, cy: cy0 / ms.length, rad: rr + 20 });
    }
    for (let i = 0; i < cents.length; i++) {
      for (let j = i + 1; j < cents.length; j++) {
        const A = cents[i];
        const B = cents[j];
        const dx = B.cx - A.cx;
        const dy = B.cy - A.cy;
        const d = Math.hypot(dx, dy) || 1;
        const minD = A.rad + B.rad;
        if (d > minD * 1.7) continue;
        const f = (minD * 1.25 - d) * 0.0011 * alpha;
        if (f <= 0) continue;
        const ux = dx / d;
        const uy = dy / d;
        for (const m of A.ms) { m.vx -= ux * f * 0.5; m.vy -= uy * f * 0.5; }
        for (const m of B.ms) { m.vx += ux * f * 0.5; m.vy += uy * f * 0.5; }
      }
    }

    // 向心 + 位置更新
    let energy = 0;
    for (const nd of nodes) {
      nd.vx += -nd.x * 0.0030 * alpha;
      nd.vy += -nd.y * 0.0030 * alpha;
      const sp = Math.hypot(nd.vx, nd.vy);
      if (sp > MAX_FORCE) {
        nd.vx = (nd.vx / sp) * MAX_FORCE;
        nd.vy = (nd.vy / sp) * MAX_FORCE;
      }
      nd.vx *= 0.86;
      nd.vy *= 0.86;
      nd.x += nd.vx;
      nd.y += nd.vy;
      energy += Math.abs(nd.vx) + Math.abs(nd.vy);
    }
    return energy / n;
  }

  _warmup(steps) {
    for (let i = 0; i < steps; i++) {
      this.alpha = Math.max(0.02, this.alpha * 0.985);
      this._simulate();
    }
    this._settle();
  }

  _settle() {
    for (const n of this.nodes) { n.vx = 0; n.vy = 0; }
  }

  /* ---------------- 视图变换 ---------------- */

  /* 布局天然偏竖长；按画布宽高比把较窄的一轴轻轻拉开，
     让两端（桌面横屏 / 手机竖屏）都能填满可用空间。 */
  _stretchToAspect() {
    if (!this.w || !this.h) return;
    if (this.nodes.length < 3) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw < 1 || bh < 1) return;
    const target = Math.max(0.55, this.w / this.h);
    const cur = bw / bh;
    if (Math.abs(cur - target) < 0.05) return;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let sx = 1;
    let sy = 1;
    if (cur < target) sx = Math.min(target / cur, 1.9);
    else sy = Math.min(cur / target, 1.9);
    for (const n of this.nodes) {
      n.x = cx + (n.x - cx) * sx;
      n.y = cy + (n.y - cy) * sy;
    }
  }

  _fitNow() {
    if (!this.nodes.length || !this.w || !this.h) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    const pad = 78;
    const w = Math.max(maxX - minX, 1) + pad * 2;
    const h = Math.max(maxY - minY, 1) + pad * 2;
    const k = Math.min(this.w / w, this.h / h, 1.5);
    this.transform.k = k;
    this.transform.x = this.w / 2 - ((minX + maxX) / 2) * k;
    this.transform.y = this.h / 2 - ((minY + maxY) / 2) * k;
  }

  fit() {
    this._fitNow();
    this._draw();
  }

  zoomTo(k) {
    const cx = this.w / 2;
    const cy = this.h / 2;
    this._zoomAt(cx, cy, k / this.transform.k);
    this._draw();
  }

  _zoomAt(sx, sy, factor) {
    const t = this.transform;
    const k = Math.min(3.2, Math.max(0.16, t.k * factor));
    const real = k / t.k;
    t.x = sx - (sx - t.x) * real;
    t.y = sy - (sy - t.y) * real;
    t.k = k;
  }

  _animateTo(wx, wy, k) {
    const t = this.transform;
    const start = { ...t };
    const end = { k, x: this.w / 2 - wx * k, y: this.h / 2 - wy * k };
    const t0 = performance.now();
    const dur = 380;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      t.k = start.k + (end.k - start.k) * e;
      t.x = start.x + (end.x - start.x) * e;
      t.y = start.y + (end.y - start.y) * e;
      this._draw();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------------- 交互 ---------------- */

  _bindEvents() {
    const c = this.canvas;
    let dragging = false;
    let lastX = 0, lastY = 0;
    let downX = 0, downY = 0;
    let moved = false;
    const pointers = new Map();
    let pinchDist = 0;

    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, pos(e));
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        dragging = false;
        return;
      }
      dragging = true;
      moved = false;
      const p = pos(e);
      lastX = p.x; lastY = p.y; downX = p.x; downY = p.y;
      c.classList.add('dragging');
    });

    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (pinchDist > 0) {
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          this._zoomAt(mid.x, mid.y, d / pinchDist);
          this._draw();
        }
        pinchDist = d;
        return;
      }

      if (dragging) {
        const dx = p.x - lastX;
        const dy = p.y - lastY;
        if (Math.abs(p.x - downX) + Math.abs(p.y - downY) > 4) moved = true;
        this.transform.x += dx;
        this.transform.y += dy;
        lastX = p.x; lastY = p.y;
        this._draw();
      } else {
        const hit = this._hitTest(p.x, p.y);
        if (hit?.id !== this.hoverId) {
          this.hoverId = hit?.id || null;
          this.onHover?.(this.hoverId);
          this._draw();
        }
        c.style.cursor = hit ? 'pointer' : 'grab';
      }
    });

    const end = (e) => {
      pointers.delete(e.pointerId);
      c.classList.remove('dragging');
      if (pointers.size > 0) return;
      if (dragging && !moved) {
        const p = pos(e);
        const hit = this._hitTest(p.x, p.y);
        this.select(hit?.id || null);
      }
      dragging = false;
      pinchDist = 0;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = pos(e);
        const factor = Math.exp(-e.deltaY * 0.0016);
        this._zoomAt(p.x, p.y, factor);
        this._draw();
      },
      { passive: false }
    );

    c.addEventListener('pointerleave', () => {
      if (this.hoverId) { this.hoverId = null; this.onHover?.(null); this._draw(); }
    });
  }

  _hitTest(sx, sy) {
    const t = this.transform;
    const wx = (sx - t.x) / t.k;
    const wy = (sy - t.y) / t.k;
    let best = null;
    let bestD = Infinity;
    for (const n of this.visibleNodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < n.r + 6 && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  /* ---------------- 绘制 ---------------- */

  _draw() {
    const ctx = this.ctx;
    const t = this.transform;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    const visible = this.visibleNodes;
    const visSet = new Set(visible.map((n) => n.id));
    this._labelBoxes = [];

    // 词团光晕（先画，位于底层）
    for (const c of this.clusters) {
      if (this.hiddenClusters.has(c.id)) continue;
      const members = c.memberIds.map((id) => this.nodeMap.get(id)).filter((m) => m && visSet.has(m.id));
      if (!members.length) continue;
      this._drawCluster(ctx, c, members);
    }

    // 关系边
    for (const l of this.links) {
      if (!visSet.has(l.a) || !visSet.has(l.b)) continue;
      const a = this.nodeMap.get(l.a);
      const b = this.nodeMap.get(l.b);
      const st = TYPE_STYLE[l.type] || TYPE_STYLE.custom;
      const highlight = this.selectedId && (l.a === this.selectedId || l.b === this.selectedId);
      ctx.beginPath();
      ctx.setLineDash(st.dash || []);
      ctx.lineWidth = (highlight ? 1.8 : 1) / Math.sqrt(t.k);
      ctx.strokeStyle = hexAlpha(st.color, highlight ? 0.75 : 0.22);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 节点（权重高的先画，标签优先占位）
    const showLabel = t.k > 0.34;
    const ordered = [...visible].sort((a, b) => (b.weight || 1) - (a.weight || 1));
    for (const n of ordered) {
      this._drawNode(ctx, n, showLabel);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawCluster(ctx, cluster, members) {
    const color = cluster.color || '#8b8377';
    const xs = members.map((m) => m.x);
    const ys = members.map((m) => m.y);

    if (members.length === 1) {
      const m = members[0];
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r + 18, 0, TAU);
      ctx.fillStyle = hexAlpha(color, 0.07);
      ctx.fill();
      ctx.strokeStyle = hexAlpha(color, 0.35);
      ctx.lineWidth = 1.4 / Math.sqrt(this.transform.k);
      ctx.stroke();
      return;
    }

    if (members.length === 2) {
      const [a, b] = members;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineCap = 'round';
      ctx.lineWidth = (a.r + b.r) * 0.9;
      ctx.strokeStyle = hexAlpha(color, 0.07);
      ctx.stroke();
      ctx.lineWidth = 1.4 / Math.sqrt(this.transform.k);
      ctx.strokeStyle = hexAlpha(color, 0.3);
      ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }

    const pts = convexHull(members.map((m) => ({ x: m.x, y: m.y })));
    if (pts.length < 3) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const pad = 18 + Math.max(...members.map((m) => m.r));
    const expanded = pts.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * pad, y: p.y + (dy / d) * pad };
    });

    ctx.beginPath();
    smoothClosed(ctx, expanded);
    ctx.closePath();
    ctx.fillStyle = hexAlpha(color, 0.075);
    ctx.fill();
    ctx.strokeStyle = hexAlpha(color, 0.42);
    ctx.lineWidth = 1.5 / Math.sqrt(this.transform.k);
    ctx.stroke();

    // 词团名
    if (this.transform.k > 0.3) {
      let top = expanded[0];
      for (const p of expanded) if (p.y < top.y) top = p;
      ctx.font = `600 ${12 / (this.transform.k || 1)}px ${getComputedStyle(document.body).fontFamily}`;
      const label = cluster.name;
      const w = ctx.measureText(label).width;
      const lx = top.x;
      const ly = top.y - 14;
      ctx.fillStyle = 'rgba(255,253,248,.88)';
      const lh = 20 / (this.transform.k || 1);
      roundRect(ctx, lx - w / 2 - 7 / (this.transform.k || 1), ly - lh + 4 / (this.transform.k || 1), w + 14 / (this.transform.k || 1), lh, 6 / (this.transform.k || 1));
      ctx.fill();
      ctx.fillStyle = hexAlpha(color, 0.95);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly - 6 / (this.transform.k || 1));
      this._labelBoxes.push({
        x0: lx - w / 2 - 6 / (this.transform.k || 1),
        x1: lx + w / 2 + 6 / (this.transform.k || 1),
        y0: ly - lh,
        y1: ly + 2 / (this.transform.k || 1),
      });
    }
  }

  _drawNode(ctx, n, showLabel) {
    const isSel = n.id === this.selectedId;
    const isHover = n.id === this.hoverId;
    const r = n.r * (isSel ? 1.12 : isHover ? 1.06 : 1);
    const clusterColors = (n.clusterIds || [])
      .filter((id) => !this.hiddenClusters.has(id))
      .map((id) => this.clusters.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => c.color);

    // 光晕
    if (isSel || isHover) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 8, 0, TAU);
      ctx.fillStyle = hexAlpha(clusterColors[0] || '#b8452f', 0.14);
      ctx.fill();
    }

    // 主体
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, TAU);
    ctx.fillStyle = isSel ? '#fffdf8' : 'rgba(255,253,248,.96)';
    ctx.fill();

    // 多词团：用彩色圆环分段表示归属，重叠关系一眼可辨
    if (clusterColors.length > 1) {
      const seg = TAU / clusterColors.length;
      const lw = 3.2;
      for (let i = 0; i < clusterColors.length; i++) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r - lw / 2 - 0.6, i * seg - Math.PI / 2, (i + 1) * seg - Math.PI / 2);
        ctx.strokeStyle = clusterColors[i];
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, TAU);
      ctx.strokeStyle = 'rgba(32,29,25,.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, TAU);
      ctx.strokeStyle = clusterColors[0] || 'rgba(32,29,25,.22)';
      ctx.lineWidth = isSel ? 2.6 : 1.8;
      ctx.stroke();
    }

    if (isSel) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4, 0, TAU);
      ctx.strokeStyle = clusterColors[0] || '#b8452f';
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 标签：统一放在节点下方，描边光晕保证在任何底色上都清楚
    if (!showLabel) return;
    const kk = this.transform.k || 1;
    const fontSize = 12 / kk;
    if (kk < 0.34) return;
    ctx.font = `600 ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = n.term;
    const ty = n.y + r + 11 / kk;
    // 标签避让：与已画标签相交时让位（选中/悬停/权重高的词始终保留）
    const tw = ctx.measureText(label).width;
    const pad = 2 / kk;
    const box = {
      x0: n.x - tw / 2 - pad,
      x1: n.x + tw / 2 + pad,
      y0: ty - fontSize * 0.62,
      y1: ty + fontSize * 0.62,
    };
    const clash = this._labelBoxes.some(
      (b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1)
    );
    if (clash && !isSel && !isHover) return;
    this._labelBoxes.push(box);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2 / kk;
    ctx.strokeStyle = 'rgba(246,242,234,.94)';
    ctx.strokeText(label, n.x, ty);
    ctx.fillStyle = isSel ? '#b8452f' : '#201d19';
    ctx.fillText(label, n.x, ty);

    // 权重角标
    if (n.weight > 1 && this.transform.k > 0.7) {
      const bs = 1 / (this.transform.k || 1);
      const bx = n.x + r * 0.72;
      const by = n.y - r * 0.72;
      const br = 7.2 * bs;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fillStyle = '#b8452f';
      ctx.fill();
      ctx.fillStyle = '#fff8f4';
      ctx.font = `700 ${9.5 * bs}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillText(String(n.weight), bx, by + 0.5);
    }
  }

  destroy() {
    this.stop();
    this._ro.disconnect();
    this.canvas.remove();
  }
}

/* ---------------- 几何工具 ---------------- */

function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function smoothClosed(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let m = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m.x, m.y);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const mm = mid(cur, next);
    ctx.quadraticCurveTo(cur.x, cur.y, mm.x, mm.y);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexAlpha(hex, a) {
  if (!hex) return `rgba(32,29,25,${a})`;
  if (hex.startsWith('rgb')) return hex;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full.slice(0, 6), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${a})`;
}
