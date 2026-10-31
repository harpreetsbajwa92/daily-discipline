-- Daily Discipline cloud sync: run once in Supabase Dashboard > SQL Editor.
-- One row per localStorage key (nn-v1:*) per user. Row Level Security: each signed-in user can only see/change their own rows.
create table if not exists public.kv (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  k          text        not null,
  v          text,
  t          bigint      not null default 0,          -- device edit time (ms), used to pick the newer side when merging
  deleted    boolean     not null default false,
  base       timestamptz,                               -- sent by the client: the server version this edit was based on
  updated_at timestamptz not null default clock_timestamp(),  -- server time, used as the pull cursor
  primary key (user_id, k)
);
create index if not exists kv_user_updated on public.kv (user_id, updated_at);
alter table public.kv enable row level security;
drop policy if exists kv_select on public.kv; drop policy if exists kv_insert on public.kv;
drop policy if exists kv_update on public.kv; drop policy if exists kv_delete on public.kv;
create policy kv_select on public.kv for select to authenticated using ((select auth.uid()) = user_id);
create policy kv_insert on public.kv for insert to authenticated with check ((select auth.uid()) = user_id);
create policy kv_update on public.kv for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy kv_delete on public.kv for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.kv from anon;
grant select, insert, update, delete on public.kv to authenticated;
-- compare-and-swap: an edit made from an out-of-date copy is rejected (the old row is returned); the app then merges and retries
create or replace function public.kv_lww() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.base is distinct from old.updated_at then return old; end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists kv_lww on public.kv;
create trigger kv_lww before insert or update on public.kv for each row execute function public.kv_lww();
