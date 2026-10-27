/* 云同步：Supabase（Auth + PostgREST），不依赖 SDK，全部走原生 fetch */

import { getSettings, updateSettings, exportJSON, importJSON } from './store.js';
import { SITE } from './config.js';

const AUTH_KEY = 'vn.auth.v1';

/* ---------------- 配置 ---------------- */

export function syncConfig() {
  const s = getSettings();
  const ownUrl = String(s.supabaseUrl || '').trim().replace(/\/+$/, '');
  const ownKey = String(s.supabaseKey || '').trim();
  if (/^https?:\/\//.test(ownUrl) && ownKey.length > 20) {
    return { url: ownUrl, key: ownKey, ready: true, builtin: false };
  }
  const url = String(SITE.supabaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(SITE.supabaseAnonKey || '').trim();
  return { url, key, ready: /^https?:\/\//.test(url) && key.length > 20, builtin: true };
}

export const SYNC_SQL = `-- 在 Supabase → SQL Editor 中执行一次
create table if not exists public.vn_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.vn_state enable row level security;
create policy "own row" on public.vn_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

/* ---------------- 账号状态 ---------------- */

export function readAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (!a?.access_token || !a?.user?.id) return null;
    return a;
  } catch {
    return null;
  }
}

function saveAuth(a) {
  if (!a) localStorage.removeItem(AUTH_KEY);
  else localStorage.setItem(AUTH_KEY, JSON.stringify(a));
  window.dispatchEvent(new CustomEvent('vn:auth-changed'));
}

export function authSummary() {
  const a = readAuth();
  if (!a) return null;
  return {
    email: a.user.email || '',
    uid: a.user.id,
    anon: Boolean(a.user.is_anonymous),
    since: a.created_at || null,
    lastSyncAt: getSettings().lastSyncAt || null,
  };
}

/* ---------------- 请求 ---------------- */

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const { url, key, ready } = syncConfig();
  if (!ready) throw new Error('请先在设置中填写 Supabase URL 与 anon key');
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) throw new Error(friendly(res.status, data));
  return data;
}

function friendly(status, data) {
  const msg = data?.msg || data?.message || data?.error_description || data?.error || (typeof data === 'string' ? data : '');
  const code = data?.code || '';
  if (code === '42P01' || /relation .* does not exist/i.test(String(msg))) {
    return '云端的 vn_state 数据表还没有创建，请在 Supabase 的 SQL Editor 里执行设置页提供的建表语句';
  }
  if (status === 400 && /invalid login credentials/i.test(String(msg))) return '邮箱或密码不正确';
  if (status === 422 || /already registered/i.test(String(msg))) return '这个邮箱已经注册过了，请直接登录';
  if (status === 401) return '登录已过期，请重新登录';
  if (code === 'anonymous_provider_disabled' || /anonymous.*disabled/i.test(String(msg))) {
    return '该项目未开启匿名登录：Supabase → Authentication → Sign In / Providers → 打开 Anonymous sign-ins 后重试';
  }
  return msg ? `${status}：${msg}` : `请求失败（${status}）`;
}

/* ---------------- 登录 / 注册 ---------------- */

export async function signIn(email, password) {
  const data = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: email.trim(), password },
  });
  const auth = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: data.user,
    created_at: Date.now(),
  };
  saveAuth(auth);
  return authSummary();
}

export async function signUp(email, password) {
  const data = await request('/auth/v1/signup', {
    method: 'POST',
    body: { email: email.trim(), password },
  });
  if (data?.access_token) {
    const auth = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: data.user,
      created_at: Date.now(),
    };
    saveAuth(auth);
    return { needConfirm: false, summary: authSummary() };
  }
  return { needConfirm: true, summary: null };
}

/**
 * 匿名登录：无需邮箱与密码，Supabase 为当前浏览器分配一个独立用户，
 * 数据仍按 RLS 隔离（user_id = auth.uid()）。
 * 需要在该项目的 Authentication → Sign In / Providers 中开启 Anonymous sign-ins。
 * 匿名账号仅限本设备；如需跨设备共享，请改用邮箱注册。
 */
export async function signInAnon() {
  const data = await request('/auth/v1/signup', {
    method: 'POST',
    body: { data: {}, gotrue_meta_security: {} },
  });
  if (!data?.access_token) throw new Error('匿名登录失败，请检查项目设置');
  saveAuth({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: data.user,
    created_at: Date.now(),
  });
  return authSummary();
}

export function signOut() {
  saveAuth(null);
}

async function ensureToken() {
  const a = readAuth();
  if (!a) throw new Error('请先登录');
  if (Date.now() < (a.expires_at || 0) - 60000) return a;
  if (!a.refresh_token) { saveAuth(null); throw new Error('登录已过期，请重新登录'); }
  try {
    const data = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: a.refresh_token },
    });
    const next = {
      ...a,
      access_token: data.access_token,
      refresh_token: data.refresh_token || a.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: data.user || a.user,
    };
    saveAuth(next);
    return next;
  } catch (e) {
    saveAuth(null);
    throw new Error(`登录已过期，请重新登录（${e.message}）`);
  }
}

/* ---------------- 同步 ---------------- */

let syncing = false;

export async function pullRemote() {
  const a = await ensureToken();
  const rows = await request(
    `/rest/v1/vn_state?user_id=eq.${a.user.id}&select=data,updated_at`,
    { token: a.access_token }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return row?.data && Object.keys(row.data).length ? row.data : null;
}

export async function pushLocal() {
  const a = await ensureToken();
  const payload = JSON.parse(exportJSON());
  delete payload.exportedAt;
  await request('/rest/v1/vn_state', {
    method: 'POST',
    token: a.access_token,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { user_id: a.user.id, data: payload, updated_at: new Date().toISOString() },
  });
  updateSettings({ lastSyncAt: Date.now() });
  return payload;
}

/** 先拉取合并，再整体上传。返回合并信息 */
export async function syncNow() {
  if (syncing) return { ok: false, message: '正在同步中' };
  syncing = true;
  try {
    const remote = await pullRemote();
    let pulled = 0;
    if (remote) {
      const before = countAll();
      importJSON(JSON.stringify(remote), 'merge');
      pulled = countAll() - before;
    }
    await pushLocal();
    return {
      ok: true,
      pulled,
      hasRemote: Boolean(remote),
      message: pulled > 0 ? `已合并云端新增内容（+${pulled}）` : '已与云端同步',
    };
  } finally {
    syncing = false;
  }
}

function countAll() {
  const s = JSON.parse(exportJSON());
  return (s.books?.length || 0) + (s.words?.length || 0) + (s.entries?.length || 0) + (s.links?.length || 0) + (s.clusters?.length || 0) + (s.clouds?.length || 0);
}

/** 首次同步：把本地整份数据覆盖到云端（用于换设备时以本机为准） */
export async function pushOverride() {
  const a = await ensureToken();
  const payload = JSON.parse(exportJSON());
  delete payload.exportedAt;
  await request('/rest/v1/vn_state', {
    method: 'POST',
    token: a.access_token,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { user_id: a.user.id, data: payload, updated_at: new Date().toISOString() },
  });
  updateSettings({ lastSyncAt: Date.now() });
  return true;
}
