-- 词汇 · 电子英语单词本 —— 云同步所需的数据表
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴本文件全部内容 → Run（执行一次即可）
-- 表结构与 js/sync.js 里的 SYNC_SQL 保持一致。

create table if not exists public.vn_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 打开行级安全：每个账号只能读写自己那一行
alter table public.vn_state enable row level security;

-- 幂等：重复执行时先删掉同名策略，避免报 "policy already exists"
drop policy if exists "own row" on public.vn_state;
create policy "own row" on public.vn_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
