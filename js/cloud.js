/* 云盘同步：GitHub Gist
 *
 * 不使用 OAuth 应用注册，也不需要服务器：
 * 用户在自己的 GitHub 账号下生成一个只有 gist 权限的 token，粘贴进来即可。
 * 数据保存在该账号下的私有 Gist（只有本人可见），token 只存在本机浏览器。
 */

import { exportJSON, importJSON, getSettings, updateSettings } from './store.js';

const API = 'https://api.github.com';
const FILE_NAME = 'pickword-backup.json';
const DESC = '拾词 · 单词本备份';
const META_KEY = 'vn.gist.v1';
const TIMEOUT = 20000;

/* ---------------- 本地记录 ---------------- */

function readMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { token: '', gistId: '', login: '' };
    const o = JSON.parse(raw) || {};
    return { token: String(o.token || ''), gistId: String(o.gistId || ''), login: String(o.login || '') };
  } catch (e) {
    return { token: '', gistId: '', login: '' };
  }
}

function writeMeta(patch) {
  const next = { ...readMeta(), ...patch };
  try { localStorage.setItem(META_KEY, JSON.stringify(next)); } catch (e) { /* 忽略 */ }
  return next;
}

/** 供界面读取的当前状态 */
export function gistState() {
  const m = readMeta();
  return {
    connected: Boolean(m.token),
    login: m.login,
    gistId: m.gistId,
    lastSyncAt: getSettings().lastSyncAt || null,
  };
}

/* ---------------- 网络层 ---------------- */

function friendly(status, payload) {
  const msg = payload && payload.message ? String(payload.message) : '';
  if (status === 401) return 'token 无效或已过期，请重新生成一个再填写';
  if (status === 403) return 'GitHub 拒绝了这次请求：token 可能缺少 gist 权限，或触发了频率限制';
  if (status === 404) return '找不到云端备份（可能已在 GitHub 上删除）';
  if (status === 422) return `云端拒绝了这份数据${msg ? '：' + msg : ''}`;
  if (status === 429) return '请求过于频繁，请稍后再试';
  return `GitHub 返回 ${status}${msg ? '：' + msg : ''}`;
}

async function call(path, { method = 'GET', token, body } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT) : null;
  let res;
  try {
    res = await fetch(API + path, {
      method,
      signal: ctrl ? ctrl.signal : undefined,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时：网络可能不通，或被浏览器拦截');
    throw new Error('无法连接 GitHub：请检查网络');
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  let payload = null;
  if (text) { try { payload = JSON.parse(text); } catch (e) { payload = null; } }
  if (!res.ok) {
    const err = new Error(friendly(res.status, payload));
    err.status = res.status;
    throw err;
  }
  return payload;
}

const api = {
  user: (token) => call('/user', { token }),
  listGists: (token) => call('/gists?per_page=100', { token }),
  getGist: (token, id) => call(`/gists/${id}`, { token }),
  createGist: (token, text) => call('/gists', {
    method: 'POST',
    token,
    body: {
      description: DESC,
      public: false,
      files: { [FILE_NAME]: { content: text } },
    },
  }),
  updateGist: (token, id, text) => call(`/gists/${id}`, {
    method: 'PATCH',
    token,
    body: { description: DESC, files: { [FILE_NAME]: { content: text } } },
  }),
};

/* ---------------- 读写 ---------------- */

function findBackupGist(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.find((g) => g && g.files && g.files[FILE_NAME]) || null;
}

/** 读取云端内容；没有备份时返回 null */
async function readRemote(token, gistId) {
  if (!gistId) return null;
  const g = await api.getGist(token, gistId);
  const file = g && g.files ? g.files[FILE_NAME] : null;
  if (!file) return null;
  if (file.content) return file.content;
  if (file.truncated && file.raw_url) {
    const res = await fetch(file.raw_url, { cache: 'no-store' });
    if (!res.ok) throw new Error('读取云端备份失败');
    return res.text();
  }
  return null;
}

async function ensureGist(token, meta, text, knownOk = false) {
  if (meta.gistId) {
    if (knownOk) return meta.gistId;
    try {
      await api.getGist(token, meta.gistId);
      return meta.gistId;
    } catch (e) {
      if (e.status !== 404) throw e;
      // 云端备份已被删除，重新创建
    }
  }
  const created = await api.createGist(token, text);
  writeMeta({ gistId: created.id });
  return created.id;
}

/* ---------------- 对外操作 ---------------- */

/** 用 token 连接（会真实校验一次），返回登录名 */
export async function connectGist(token) {
  const t = String(token || '').trim();
  if (!t) throw new Error('先粘贴 GitHub token');
  if (!/^(gh[pousr]_|github_pat_)/.test(t)) {
    throw new Error('token 格式不对：应形如 ghp_… 或 github_pat_…');
  }
  const me = await api.user(t);
  let gistId = '';
  try {
    const list = await api.listGists(t);
    const found = findBackupGist(list);
    if (found) gistId = found.id;
  } catch (e) { /* 列表失败不影响连接 */ }
  writeMeta({ token: t, login: (me && (me.login || me.name)) || '', gistId });
  return { login: (me && me.login) || '', gistId };
}

/** 断开并清除本机保存的 token */
export function disconnectGist() {
  try { localStorage.removeItem(META_KEY); } catch (e) { /* 忽略 */ }
  updateSettings({ lastSyncAt: null });
}

/** 上传本机数据（覆盖云端） */
export async function pushGist() {
  const meta = readMeta();
  if (!meta.token) throw new Error('尚未连接 GitHub');
  const text = exportJSON();
  const id = await ensureGist(meta.token, meta, text);
  await api.updateGist(meta.token, id, text);
  updateSettings({ lastSyncAt: Date.now() });
  return { ok: true, gistId: id };
}

/** 拉取云端并合并到本机（不覆盖云端） */
export async function pullGist() {
  const meta = readMeta();
  if (!meta.token) throw new Error('尚未连接 GitHub');
  const text = await readRemote(meta.token, meta.gistId);
  if (!text) return { ok: true, empty: true };
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('云端备份已损坏，无法解析'); }
  importJSON(text, 'merge');
  updateSettings({ lastSyncAt: Date.now() });
  return { ok: true, data };
}

/** 立即同步：拉取 → 合并 → 上传 */
export async function syncGist() {
  const meta = readMeta();
  if (!meta.token) throw new Error('尚未连接 GitHub');
  const text = await readRemote(meta.token, meta.gistId);
  let merged = false;
  if (text) {
    try {
      importJSON(text, 'merge');
      merged = true;
    } catch (e) {
      throw new Error('云端备份已损坏，无法解析');
    }
  }
  const body = exportJSON();
  const id = await ensureGist(meta.token, meta, body, Boolean(text));
  await api.updateGist(meta.token, id, body);
  updateSettings({ lastSyncAt: Date.now() });
  return { ok: true, merged, created: !meta.gistId, gistId: id };
}

/** 从云端恢复（整体覆盖本机） */
export async function restoreGist() {
  const meta = readMeta();
  if (!meta.token) throw new Error('尚未连接 GitHub');
  const text = await readRemote(meta.token, meta.gistId);
  if (!text) throw new Error('云端还没有备份');
  importJSON(text, 'replace');
  updateSettings({ lastSyncAt: Date.now() });
  return { ok: true };
}
