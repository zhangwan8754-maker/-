-- =============================================================
--  情侣共享反馈记录 · 数据库结构（记录表设计）
--  在 Supabase 控制台 → SQL Editor 里，把本文件全部内容粘贴进去，
--  点 "Run" 执行一次即可。可重复执行（幂等）。
-- =============================================================

-- 需要 pgcrypto 生成 uuid（Supabase 默认已开启，这里保险再启一次）
create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- 1) 个人资料：给每个登录用户一个昵称和头像 emoji
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,                       -- 昵称，比如 "小明" / "宝宝"
  avatar_emoji  text default '🙂',          -- 头像用一个 emoji
  updated_at    timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 2) 记录表（核心）：每一条"记录/反馈"
--    type 字段就是"记录类型"，前端可自定义增减：
--      thanks 感谢 / happy 甜蜜 / care 在意 / wish 希望 / daily 日常 / mood 心情
--    mood 字段是心情打卡的分数（1-5，可空）
-- -------------------------------------------------------------
create table if not exists public.records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  author_name   text not null,              -- 冗余存一份昵称，方便展示
  type          text not null default 'daily',
  mood          int,                        -- 1..5，仅心情打卡用，其它可空
  content       text not null,              -- 记录正文
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists records_created_at_idx on public.records (created_at desc);

-- -------------------------------------------------------------
-- 3) 想法/回应表：每条记录下面双方可以互相评论
-- -------------------------------------------------------------
create table if not exists public.comments (
  id            uuid primary key default gen_random_uuid(),
  record_id     uuid not null references public.records(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  author_name   text not null,
  content       text not null,
  created_at    timestamptz not null default now()
);

create index if not exists comments_record_id_idx on public.comments (record_id, created_at);

-- -------------------------------------------------------------
-- 4) 新用户注册时自动建一条 profile
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- 5) 自动维护 records.updated_at
-- -------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists records_touch_updated_at on public.records;
create trigger records_touch_updated_at
  before update on public.records
  for each row execute function public.touch_updated_at();

-- =============================================================
--  行级安全（RLS）：这是"只有你俩能看"的关键
--  规则：登录用户可以读所有记录（因为是两个人共享的空间），
--        但只能改/删自己写的内容。
--  ⚠️ 一定要在 Supabase 后台把"允许新用户注册"关掉
--     （你俩都注册完之后），否则别人注册也能进来看。
--     位置：Authentication → Providers → Email → 关闭 "Allow new users to sign up"
-- =============================================================

alter table public.profiles enable row level security;
alter table public.records  enable row level security;
alter table public.comments enable row level security;

-- profiles：登录用户都可读；只能写自己的
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- records：登录用户都可读；只能增/改/删自己的
drop policy if exists "records_select" on public.records;
create policy "records_select" on public.records
  for select to authenticated using (true);

drop policy if exists "records_insert_own" on public.records;
create policy "records_insert_own" on public.records
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "records_update_own" on public.records;
create policy "records_update_own" on public.records
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "records_delete_own" on public.records;
create policy "records_delete_own" on public.records
  for delete to authenticated using (auth.uid() = user_id);

-- comments：登录用户都可读；只能增/删自己的
drop policy if exists "comments_select" on public.comments;
create policy "comments_select" on public.comments
  for select to authenticated using (true);

drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments
  for delete to authenticated using (auth.uid() = user_id);

-- =============================================================
--  开启实时同步（两部手机才能"实时"看到对方）
-- =============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.records;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.comments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null;
  end;
end $$;

-- 完成 ✅
