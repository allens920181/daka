-- ============================================================================
--  只在本機測試用的 auth schema 替身。
--
--  真實的 Supabase 專案已經內建 auth.users 與 auth.uid()，**不要**把這個檔案
--  貼到 Supabase。它的存在只是為了讓 schema.sql 能在一台乾淨的 PostgreSQL 上
--  跑起來、被測試。
--
--  用法：
--    psql -d daka -f supabase/schema.local-auth.sql
--    psql -d daka -f supabase/schema.sql
--    psql -d daka -f supabase/schema.test.sql
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- 與 Supabase 的實作一致：從請求的 JWT claims 取出 sub。
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant select on auth.users to authenticated;
