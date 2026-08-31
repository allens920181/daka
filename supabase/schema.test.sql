\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

-- ========== 1. anon 不能直接讀表 ==========
set role anon;
\echo '--- 1. anon 直接 select rooms（應該失敗）---'
\set ON_ERROR_STOP off
select * from public.rooms;
select * from public.room_members;
insert into public.rooms(code,name,owner_key) values ('AAAAAA','x','k12345678901234567890');
\set ON_ERROR_STOP on
reset role;

-- ========== 2. 開房 ==========
set role anon;
\echo '--- 2. create_room ---'
select jsonb_pretty(
  public.create_room(
    'K7F2QM', '秋季旅遊 · 出發', 'ownerkey-aaaaaaaaaaaaaaaaaaaa',
    '[{"name":"王小明"},{"name":"李美花","companions":1},{"name":"陳大同","note":"請假"}]'::jsonb
  ) #> '{room}'
) as room;

\echo '--- 快照不應包含 owner_key ---'
select (public.get_room('K7F2QM') #> '{room}') ? 'owner_key' as leaks_owner_key;

\echo '--- 成員數與欄位 ---'
select jsonb_array_length(public.get_room('K7F2QM') -> 'members') as member_count,
       public.get_room('K7F2QM') #>> '{members,1,name}' as second_name,
       public.get_room('K7F2QM') #>> '{members,1,companions}' as second_companions;

\echo '--- 小寫房號也要能查到 ---'
select public.get_room('k7f2qm') is not null as lowercase_ok;

\echo '--- 不存在的房號回 null ---'
select public.get_room('ZZZZZZ') is null as missing_is_null;

-- ========== 3. LWW ==========
\echo '--- 3. LWW：rev 大的勝 ---'
create temp table t as select (public.get_room('K7F2QM') #>> '{members,0,id}')::uuid as mid;

select public.set_member_status('K7F2QM', (select mid from t), 'arrived', 1000, '陳姐') ->> 'status' as after_rev1000;
-- 較小的 rev 應該打不過
select public.set_member_status('K7F2QM', (select mid from t), 'pending', 500, '王哥') ->> 'status' as after_rev500_should_stay_arrived;
select public.set_member_status('K7F2QM', (select mid from t), 'pending', 500, '王哥') ->> 'status_by' as by_should_stay;
-- 較大的 rev 應該覆蓋
select public.set_member_status('K7F2QM', (select mid from t), 'pending', 2000, '王哥') ->> 'status' as after_rev2000;

\echo '--- 不合法的 status 應該失敗 ---'
\set ON_ERROR_STOP off
select public.set_member_status('K7F2QM', (select mid from t), 'bogus', 3000, 'x');
\set ON_ERROR_STOP on

-- ========== 4. 臨時加人 ==========
\echo '--- 4. add_member ---'
select public.add_member('K7F2QM', '臨時 來賓', null, 2) ->> 'name' as added;
select jsonb_array_length(public.get_room('K7F2QM') -> 'members') as member_count_now;

-- ========== 5. owner_key 保護 ==========
\echo '--- 5. 錯誤 owner_key 應被拒 ---'
\set ON_ERROR_STOP off
select public.rename_room('K7F2QM', 'wrong-key-xxxxxxxxxxxxxxx', '亂改');
select public.replace_roster('K7F2QM', 'wrong-key-xxxxxxxxxxxxxxx', '[]'::jsonb);
select public.delete_room('K7F2QM', 'wrong-key-xxxxxxxxxxxxxxx');
\set ON_ERROR_STOP on
\echo '--- 正確 owner_key 可以改名 ---'
select public.rename_room('K7F2QM','ownerkey-aaaaaaaaaaaaaaaaaaaa','秋季旅遊 · 出發（改）') #>> '{room,name}' as renamed;

-- ========== 6. 複製房間（回程） ==========
\echo '--- 6. copy_room：名單保留、狀態歸零 ---'
select public.set_member_status('K7F2QM', (select mid from t), 'arrived', 9000, '陳姐') ->> 'status' as src_marked;

create temp table c as select public.copy_room('K7F2QM','ownerkey-aaaaaaaaaaaaaaaaaaaa','M3P8TV','秋季旅遊 · 回程') as snap;
select (select snap #>> '{room,name}' from c) as new_name,
       (select jsonb_array_length(snap -> 'members') from c) as copied_members,
       (select count(*) from jsonb_array_elements((select snap->'members' from c)) e
         where e ->> 'status' <> 'pending') as non_pending_should_be_0,
       (select snap #>> '{room,copied_from}' from c) is not null as has_copied_from;

\echo '--- 原房間狀態不受影響 ---'
select public.get_room('K7F2QM') #>> '{members,0,status}' as source_still_arrived;

-- ========== 7. 關閉房間後不能點名 ==========
\echo '--- 7. 關閉後點名應失敗 ---'
select public.set_room_closed('K7F2QM','ownerkey-aaaaaaaaaaaaaaaaaaaa',true) #>> '{room,closed_at}' is not null as closed;
\set ON_ERROR_STOP off
select public.set_member_status('K7F2QM', (select mid from t), 'pending', 99999, 'x');
\set ON_ERROR_STOP on
select public.set_room_closed('K7F2QM','ownerkey-aaaaaaaaaaaaaaaaaaaa',false) #>> '{room,closed_at}' is null as reopened;

-- ========== 8. 常用名單 ==========
\echo '--- 8. saved rosters ---'
select public.save_roster('ownerkey-aaaaaaaaaaaaaaaaaaaa','青年團契',
  '[{"name":"甲"},{"name":"乙"}]'::jsonb) #>> '{roster,name}' as saved;
select jsonb_array_length(public.list_rosters('ownerkey-aaaaaaaaaaaaaaaaaaaa')) as my_rosters,
       jsonb_array_length(public.list_rosters('someone-else-key-xxxxxxxxx')) as other_rosters_should_be_0;

-- ========== 9. 過期清理 ==========
reset role;
\echo '--- 9. purge_expired 只刪過期的 ---'
update public.rooms set expires_at = now() - interval '1 day' where code = 'M3P8TV';
set role anon;
select public.purge_expired() as purged;
select public.get_room('M3P8TV') is null as expired_gone,
       public.get_room('K7F2QM') is not null as live_kept;
reset role;

-- ========== 10. 房號格式檢查 ==========
\echo '--- 10. 含混淆字元的房號應被拒 (0/O/1/I/L) ---'
set role anon;
\set ON_ERROR_STOP off
select public.create_room('ABC0DE','x','ownerkey-bbbbbbbbbbbbbbbbbbbb');
select public.create_room('ABCIDE','x','ownerkey-bbbbbbbbbbbbbbbbbbbb');
select public.create_room('ABCLDE','x','ownerkey-bbbbbbbbbbbbbbbbbbbb');
select public.create_room('ABCDE','x','ownerkey-bbbbbbbbbbbbbbbbbbbb');
\set ON_ERROR_STOP on
select public.create_room('ABCDEF','合法','ownerkey-bbbbbbbbbbbbbbbbbbbb') #>> '{room,code}' as valid_code_ok;
reset role;

-- ========== 11. save_roster 驗證失敗時不可清空既有名單 ==========
\echo '--- 11. 更新常用名單時傳入不合法 payload，舊資料要保住 ---'
set role anon;
create temp table r as select (public.save_roster('ownerkey-ccccccccccccccccccc','小組',
  '[{"name":"甲"},{"name":"乙"},{"name":"丙"}]'::jsonb) #>> '{roster,id}')::uuid as rid;
\set ON_ERROR_STOP off
select public.save_roster('ownerkey-ccccccccccccccccccc','小組','"not-an-array"'::jsonb, (select rid from r));
\set ON_ERROR_STOP on
select jsonb_array_length(public.list_rosters('ownerkey-ccccccccccccccccccc') #> '{0,members}')
       as members_should_still_be_3;
reset role;

-- ========== 12. add_member 冪等（待送佇列重送不可產生重複的人）==========
\echo '--- 12. 同一個 member_id 重送兩次只會有一個人 ---'
set role anon;
select public.create_room('QRSTUV','冪等測試','ownerkey-ddddddddddddddddddd','[]'::jsonb) #>> '{room,code}' as room_made;
select public.add_member('QRSTUV','臨時來賓',null,0,null,'11111111-1111-1111-1111-111111111111'::uuid) ->> 'name' as first_add;
select public.add_member('QRSTUV','臨時來賓',null,0,null,'11111111-1111-1111-1111-111111111111'::uuid) ->> 'name' as retry_add;
select jsonb_array_length(public.get_room('QRSTUV') -> 'members') as should_be_1;
\echo '--- 不給 id 仍可新增（每次都是新的人）---'
select public.add_member('QRSTUV','路人甲') ->> 'name' as no_id_add;
select jsonb_array_length(public.get_room('QRSTUV') -> 'members') as should_be_2;
reset role;

-- ========== 13. phone 欄位：建房、複製、臨時加人都要保留 ==========
\echo '--- 13. 電話號碼流過整條路徑 ---'
set role anon;
select public.create_room('WXY234','電話測試','ownerkey-eeeeeeeeeeeeeeeeeee',
  '[{"name":"王小明","phone":"0912345678"}]'::jsonb) #>> '{members,0,phone}' as created_phone;
select public.add_member('WXY234','李美花',null,0,null,null,'0987654321') ->> 'phone' as added_phone;
select public.copy_room('WXY234','ownerkey-eeeeeeeeeeeeeeeeeee','ZAB345','回程') #>> '{members,0,phone}' as copied_phone;
reset role;
