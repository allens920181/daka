-- ============================================================================
--  點名房間 · Supabase Schema
--  貼到 Supabase Dashboard → SQL Editor → Run（整份一次執行，可重複執行）
-- ============================================================================
--
--  安全模型（重要，請先讀）
--  ------------------------------------------------------------------------
--  1. 三張資料表都開啟 RLS 且「不建立任何 policy」，因此前端拿著 anon key
--     也「無法直接讀寫任何一列」。所有存取都必須經過下面的 RPC 函式。
--  2. RPC 函式是 SECURITY DEFINER，並且都要求傳入房號（code）才給資料。
--     → 房號就是密碼。拿到房號的人＝可以看名單、可以點名。這正是產品要的
--       「掃 QR 就能點名，不用註冊」。
--  3. 破壞性操作（改名單、複製、關閉、刪除）另外要求 owner_key，
--     只有開房的那台裝置有。
--  4. 房號是 6 碼、31 個不易混淆的字元（去掉 0/O/1/I/L），約 8.9 億組合。
--     這對「幾十人的教會活動、30 天後自動刪除」是合理的；但它不是高強度
--     機密，別放敏感資料。房間預設 30 天後過期，purge_expired() 會清掉。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 資料表
-- ---------------------------------------------------------------------------

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null unique
                          check (code ~ '^[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
  name        text        not null check (length(name) between 1 and 80),
  note        text        check (note is null or length(note) <= 200),
  owner_key   text        not null check (length(owner_key) between 20 and 100),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  closed_at   timestamptz,
  copied_from uuid        references public.rooms(id) on delete set null
);

create index if not exists rooms_expires_at_idx on public.rooms (expires_at);

create table if not exists public.room_members (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid        not null references public.rooms(id) on delete cascade,
  name         text        not null check (length(name) between 1 and 60),
  note         text        check (note is null or length(note) <= 200),
  phone        text        check (phone is null or length(phone) <= 30),
  companions   smallint    not null default 0 check (companions between 0 and 99),
  group_label  text        check (group_label is null or length(group_label) <= 20),
  sort_order   integer     not null default 0,
  status       text        not null default 'pending'
                           check (status in ('pending', 'arrived', 'excused')),
  status_at    timestamptz,
  status_by    text        check (status_by is null or length(status_by) <= 40),
  -- rev：單調遞增的版本號（客戶端以 max(已見過的 rev)+1 與 epoch 毫秒取大者產生）。
  -- 五台裝置同時改同一個人時，rev 大的勝出。見 src/lib/merge.ts。
  rev          bigint      not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists room_members_room_idx on public.room_members (room_id, sort_order, created_at);

-- 常用名單：綁在裝置自己的 owner_key 上，不跨裝置共用。
create table if not exists public.saved_rosters (
  id         uuid primary key default gen_random_uuid(),
  owner_key  text        not null check (length(owner_key) between 20 and 100),
  name       text        not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_rosters_owner_idx on public.saved_rosters (owner_key, updated_at desc);

create table if not exists public.saved_roster_members (
  id          uuid primary key default gen_random_uuid(),
  roster_id   uuid     not null references public.saved_rosters(id) on delete cascade,
  name        text     not null check (length(name) between 1 and 60),
  note        text     check (note is null or length(note) <= 200),
  phone       text     check (phone is null or length(phone) <= 30),
  companions  smallint not null default 0 check (companions between 0 and 99),
  group_label text     check (group_label is null or length(group_label) <= 20),
  sort_order  integer  not null default 0
);

create index if not exists saved_roster_members_roster_idx on public.saved_roster_members (roster_id, sort_order);

-- 從舊版升級用：這兩個欄位是後來才加的（重複執行安全）。
alter table public.room_members         add column if not exists phone text;
alter table public.saved_roster_members add column if not exists phone text;

-- ---------------------------------------------------------------------------
-- RLS：全部開啟、不給 policy ⇒ anon / authenticated 都無法直接存取。
-- ---------------------------------------------------------------------------

alter table public.rooms                enable row level security;
alter table public.room_members         enable row level security;
alter table public.saved_rosters        enable row level security;
alter table public.saved_roster_members enable row level security;

revoke all on public.rooms, public.room_members,
              public.saved_rosters, public.saved_roster_members
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 內部輔助函式（不開放給前端呼叫）
-- ---------------------------------------------------------------------------

-- 取出房間快照。刻意不回傳 owner_key。
create or replace function public._room_snapshot(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'room', (
      select to_jsonb(r) - 'owner_key'
      from public.rooms r
      where r.id = p_room_id
    ),
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.sort_order, m.created_at, m.id)
      from public.room_members m
      where m.room_id = p_room_id
    ), '[]'::jsonb)
  );
$$;

-- 依房號取得未過期的房間 id；找不到就回 null。
create or replace function public._room_id(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id
  from public.rooms r
  where r.code = upper(trim(p_code))
    and r.expires_at > now();
$$;

-- 依房號 + owner_key 取得房間 id；驗證失敗就丟錯。
create or replace function public._owned_room_id(p_code text, p_owner_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select r.id into v_id
  from public.rooms r
  where r.code = upper(trim(p_code))
    and r.expires_at > now()
    and r.owner_key = p_owner_key;

  if v_id is null then
    raise exception 'room_not_found_or_not_owner' using errcode = '42501';
  end if;

  return v_id;
end;
$$;

-- 把 jsonb 陣列寫成 room_members。
create or replace function public._insert_members(p_room_id uuid, p_members jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    return;
  end if;

  if jsonb_array_length(p_members) > 1000 then
    raise exception 'too_many_members' using errcode = '22023';
  end if;

  insert into public.room_members (room_id, name, note, phone, companions, group_label, sort_order, status)
  select
    p_room_id,
    left(btrim(e.value ->> 'name'), 60),
    nullif(left(btrim(coalesce(e.value ->> 'note', '')), 200), ''),
    nullif(left(btrim(coalesce(e.value ->> 'phone', '')), 30), ''),
    least(greatest(coalesce((e.value ->> 'companions')::int, 0), 0), 99),
    nullif(left(btrim(coalesce(e.value ->> 'group_label', '')), 20), ''),
    e.ordinality::int,
    -- 名單上就寫請假的人直接標成請假，不要混進未到清單。
    case when e.value ->> 'status' = 'excused' then 'excused' else 'pending' end
  from jsonb_array_elements(p_members) with ordinality as e(value, ordinality)
  where btrim(coalesce(e.value ->> 'name', '')) <> '';
end;
$$;

revoke all on function public._room_snapshot(uuid)          from public, anon, authenticated;
revoke all on function public._room_id(text)                from public, anon, authenticated;
revoke all on function public._owned_room_id(text, text)    from public, anon, authenticated;
revoke all on function public._insert_members(uuid, jsonb)  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 開房 / 加入
-- ---------------------------------------------------------------------------

-- 開啟房間。房號由前端產生（見 src/lib/code.ts），撞號時前端重試。
create or replace function public.create_room(
  p_code      text,
  p_name      text,
  p_owner_key text,
  p_members   jsonb default '[]'::jsonb,
  p_note      text  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.rooms (code, name, note, owner_key)
  values (
    upper(btrim(p_code)),
    left(btrim(p_name), 80),
    nullif(left(btrim(coalesce(p_note, '')), 200), ''),
    p_owner_key
  )
  returning id into v_id;

  perform public._insert_members(v_id, p_members);

  return public._room_snapshot(v_id);
end;
$$;

-- 加入房間 / 取得快照。這也是離線回來之後的「對帳」用函式。
create or replace function public.get_room(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public._room_id(p_code);
begin
  if v_id is null then
    return null;
  end if;
  return public._room_snapshot(v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 點名（任何拿到房號的人都能做）
-- ---------------------------------------------------------------------------

-- 設定單一成員狀態。後寫者勝：只有 p_rev 比資料庫大才會覆蓋。
-- 無論勝負都回傳資料庫目前的那一列，讓輸的裝置可以自我修正。
create or replace function public.set_member_status(
  p_code      text,
  p_member_id uuid,
  p_status    text,
  p_rev       bigint,
  p_by        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room_id uuid := public._room_id(p_code);
  v_row     public.room_members;
begin
  if v_room_id is null then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;

  if p_status not in ('pending', 'arrived', 'excused') then
    raise exception 'bad_status' using errcode = '22023';
  end if;

  if exists (select 1 from public.rooms where id = v_room_id and closed_at is not null) then
    raise exception 'room_closed' using errcode = '22023';
  end if;

  update public.room_members m
     set status    = p_status,
         status_at = now(),
         status_by = nullif(left(btrim(coalesce(p_by, '')), 40), ''),
         rev       = p_rev
   where m.id = p_member_id
     and m.room_id = v_room_id
     and p_rev > m.rev;

  select * into v_row
  from public.room_members
  where id = p_member_id and room_id = v_room_id;

  if v_row.id is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$$;

-- 臨時加人：沒報名但出現的人。
--
-- p_member_id 由前端產生並帶進來，讓這個函式是「冪等」的：待送佇列在
-- 網路不穩時會重送同一筆，沒有固定 id 就會變成重複的人。
--
-- 舊版簽章少一個參數，加預設值會變成多載而非取代，所以先明確 drop。
drop function if exists public.add_member(text, text, text, int, text);
drop function if exists public.add_member(text, text, text, int, text, uuid);

create or replace function public.add_member(
  p_code        text,
  p_name        text,
  p_note        text default null,
  p_companions  int  default 0,
  p_group_label text default null,
  p_member_id   uuid default null,
  p_phone       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room_id uuid := public._room_id(p_code);
  v_id      uuid := coalesce(p_member_id, gen_random_uuid());
  v_row     public.room_members;
begin
  if v_room_id is null then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'empty_name' using errcode = '22023';
  end if;

  -- 已經存在就直接回傳，重送不會產生第二個人。
  select * into v_row from public.room_members where id = v_id;
  if v_row.id is not null then
    if v_row.room_id <> v_room_id then
      raise exception 'member_id_conflict' using errcode = '23505';
    end if;
    return to_jsonb(v_row);
  end if;

  if (select count(*) from public.room_members where room_id = v_room_id) >= 1000 then
    raise exception 'too_many_members' using errcode = '22023';
  end if;

  insert into public.room_members (id, room_id, name, note, phone, companions, group_label, sort_order)
  values (
    v_id,
    v_room_id,
    left(btrim(p_name), 60),
    nullif(left(btrim(coalesce(p_note, '')), 200), ''),
    nullif(left(btrim(coalesce(p_phone, '')), 30), ''),
    least(greatest(coalesce(p_companions, 0), 0), 99),
    nullif(left(btrim(coalesce(p_group_label, '')), 20), ''),
    coalesce((select max(sort_order) from public.room_members where room_id = v_room_id), 0) + 1
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- 房主專用（需要 owner_key）
-- ---------------------------------------------------------------------------

-- 整份換掉名單（會清掉現有點名狀態，前端要先確認）。
create or replace function public.replace_roster(
  p_code      text,
  p_owner_key text,
  p_members   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public._owned_room_id(p_code, p_owner_key);
begin
  delete from public.room_members where room_id = v_id;
  perform public._insert_members(v_id, p_members);
  return public._room_snapshot(v_id);
end;
$$;

-- 改一個人的分組（分車）。屬於名單編輯，所以需要 owner_key。
create or replace function public.set_member_group(
  p_code        text,
  p_owner_key   text,
  p_member_id   uuid,
  p_group_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public._owned_room_id(p_code, p_owner_key);
begin
  update public.room_members
     set group_label = nullif(left(btrim(coalesce(p_group_label, '')), 20), '')
   where room_id = v_id and id = p_member_id;
  return public._room_snapshot(v_id);
end;
$$;

-- 移除單一成員。
create or replace function public.remove_member(
  p_code      text,
  p_owner_key text,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public._owned_room_id(p_code, p_owner_key);
begin
  delete from public.room_members where room_id = v_id and id = p_member_id;
  return public._room_snapshot(v_id);
end;
$$;

-- 複製房間：同一份名單、已到狀態歸零。回程點名靠這個。
--
-- 請假的人不歸零：他整趟都不會出現，回程當然也不在。把他重設成未到
-- 只會讓人在休息站打電話給一個從來沒上車的人。
-- 新房間沿用同一個 owner_key，所以還是同一個人管。
create or replace function public.copy_room(
  p_code      text,
  p_owner_key text,
  p_new_code  text,
  p_new_name  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src uuid := public._owned_room_id(p_code, p_owner_key);
  v_new uuid;
begin
  insert into public.rooms (code, name, note, owner_key, copied_from)
  select upper(btrim(p_new_code)), left(btrim(p_new_name), 80), r.note, r.owner_key, r.id
  from public.rooms r
  where r.id = v_src
  returning id into v_new;

  insert into public.room_members (room_id, name, note, phone, companions, group_label, sort_order, status)
  select v_new, m.name, m.note, m.phone, m.companions, m.group_label, m.sort_order,
         case when m.status = 'excused' then 'excused' else 'pending' end
  from public.room_members m
  where m.room_id = v_src;

  return public._room_snapshot(v_new);
end;
$$;

create or replace function public.rename_room(
  p_code      text,
  p_owner_key text,
  p_name      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public._owned_room_id(p_code, p_owner_key);
begin
  update public.rooms set name = left(btrim(p_name), 80) where id = v_id;
  return public._room_snapshot(v_id);
end;
$$;

-- 關閉／重新開啟房間。關閉後不能再點名。
create or replace function public.set_room_closed(
  p_code      text,
  p_owner_key text,
  p_closed    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public._owned_room_id(p_code, p_owner_key);
begin
  update public.rooms
     set closed_at = case when p_closed then now() else null end
   where id = v_id;
  return public._room_snapshot(v_id);
end;
$$;

create or replace function public.delete_room(p_code text, p_owner_key text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public._owned_room_id(p_code, p_owner_key);
begin
  delete from public.rooms where id = v_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 常用名單（綁裝置的 owner_key，不跨裝置）
-- ---------------------------------------------------------------------------

create or replace function public.save_roster(
  p_owner_key text,
  p_name      text,
  p_members   jsonb,
  p_roster_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if length(coalesce(p_owner_key, '')) < 20 then
    raise exception 'bad_owner_key' using errcode = '22023';
  end if;

  -- 先驗證再動資料：更新既有名單時會先 delete 舊成員，
  -- 若這裡才發現 payload 不合法，名單就會被清空。
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'bad_members' using errcode = '22023';
  end if;

  if jsonb_array_length(p_members) > 1000 then
    raise exception 'too_many_members' using errcode = '22023';
  end if;

  if p_roster_id is not null then
    update public.saved_rosters
       set name = left(btrim(p_name), 80), updated_at = now()
     where id = p_roster_id and owner_key = p_owner_key
    returning id into v_id;

    if v_id is null then
      raise exception 'roster_not_found' using errcode = 'P0002';
    end if;

    delete from public.saved_roster_members where roster_id = v_id;
  else
    if (select count(*) from public.saved_rosters where owner_key = p_owner_key) >= 50 then
      raise exception 'too_many_rosters' using errcode = '22023';
    end if;

    insert into public.saved_rosters (owner_key, name)
    values (p_owner_key, left(btrim(p_name), 80))
    returning id into v_id;
  end if;

  insert into public.saved_roster_members (roster_id, name, note, phone, companions, group_label, sort_order)
  select
    v_id,
    left(btrim(e.value ->> 'name'), 60),
    nullif(left(btrim(coalesce(e.value ->> 'note', '')), 200), ''),
    nullif(left(btrim(coalesce(e.value ->> 'phone', '')), 30), ''),
    least(greatest(coalesce((e.value ->> 'companions')::int, 0), 0), 99),
    nullif(left(btrim(coalesce(e.value ->> 'group_label', '')), 20), ''),
    e.ordinality::int
  from jsonb_array_elements(p_members) with ordinality as e(value, ordinality)
  where btrim(coalesce(e.value ->> 'name', '')) <> '';

  return jsonb_build_object(
    'roster',  (select to_jsonb(r) - 'owner_key' from public.saved_rosters r where r.id = v_id),
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.sort_order, m.id)
      from public.saved_roster_members m where m.roster_id = v_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_rosters(p_owner_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x order by x ->> 'updated_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',         r.id,
      'name',       r.name,
      'updated_at', r.updated_at,
      'members',    coalesce((
        select jsonb_agg(to_jsonb(m) - 'roster_id' order by m.sort_order, m.id)
        from public.saved_roster_members m where m.roster_id = r.id
      ), '[]'::jsonb)
    ) as x
    from public.saved_rosters r
    where r.owner_key = p_owner_key
  ) s;
$$;

create or replace function public.delete_roster(p_owner_key text, p_roster_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.saved_rosters where id = p_roster_id and owner_key = p_owner_key;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 維運
-- ---------------------------------------------------------------------------

-- 刪除過期房間。安全：只刪已經過期的資料。
create or replace function public.purge_expired()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from public.rooms where expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 保活 ping。免費方案閒置會暫停專案，用 GitHub Actions 每週打一次；
-- 順手把過期房間清掉。
create or replace function public.ping()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object('now', now(), 'purged', public.purge_expired());
end;
$$;

-- ---------------------------------------------------------------------------
-- 授權：只有這些函式對外開放
-- ---------------------------------------------------------------------------

grant execute on function public.create_room(text, text, text, jsonb, text)      to anon, authenticated;
grant execute on function public.get_room(text)                                  to anon, authenticated;
grant execute on function public.set_member_status(text, uuid, text, bigint, text) to anon, authenticated;
grant execute on function public.add_member(text, text, text, int, text, uuid, text) to anon, authenticated;
grant execute on function public.replace_roster(text, text, jsonb)               to anon, authenticated;
grant execute on function public.remove_member(text, text, uuid)                 to anon, authenticated;
grant execute on function public.set_member_group(text, text, uuid, text)        to anon, authenticated;
grant execute on function public.copy_room(text, text, text, text)               to anon, authenticated;
grant execute on function public.rename_room(text, text, text)                   to anon, authenticated;
grant execute on function public.set_room_closed(text, text, boolean)            to anon, authenticated;
grant execute on function public.delete_room(text, text)                         to anon, authenticated;
grant execute on function public.save_roster(text, text, jsonb, uuid)            to anon, authenticated;
grant execute on function public.list_rosters(text)                              to anon, authenticated;
grant execute on function public.delete_roster(text, uuid)                       to anon, authenticated;
grant execute on function public.purge_expired()                                 to anon, authenticated;
grant execute on function public.ping()                                          to anon, authenticated;

-- ============================================================================
--  完成。接著到 Settings → API 複製 Project URL 與 anon public key，
--  填進 GitHub repo 的 Actions secrets（見 README）。
-- ============================================================================
