-- =====================================================================
-- 24번 파일: 「보기 전용」 계정 권한 (role = 'viewer')
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨)
--  - 보기 전용: 시설팀 계정(일반)이 볼 수 있는 화면·자료는 모두 조회 가능, 추가·수정·삭제·사진 올리기는 전부 막힘
--  - 막는 건 DB에서 함 (화면을 우회해도 저장 안 됨)
--  - 관리자 전용 화면(변경 기록, 사용자 관리 등)은 지금처럼 관리자만
--  - 나중에 새 표를 만들면 이 파일을 한 번 더 실행하면 그 표에도 똑같이 적용됨
-- =====================================================================

-- 1) 권한 종류에 viewer 추가
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'user', 'partner', 'viewer'));

-- 2) 보기 전용 계정인지
create or replace function public.is_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'viewer');
$$;
revoke execute on function public.is_viewer() from public, anon;
grant  execute on function public.is_viewer() to authenticated;

-- 3) 모든 표: 보기 전용은 조회 허용 + 추가·수정·삭제 금지 (변경 기록 audit_log 는 관리자만이라 제외)
--    (저장 함수 meter_save · pm_complete_item 은 is_active_user() 로 막혀 있어 보기 전용은 못 씀)
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname <> 'audit_log'
  loop
    execute format('drop policy if exists viewer_read on public.%I', t.relname);
    execute format('create policy viewer_read on public.%I for select to authenticated using (public.is_viewer())', t.relname);
    execute format('drop policy if exists viewer_no_insert on public.%I', t.relname);
    execute format('create policy viewer_no_insert on public.%I as restrictive for insert to authenticated with check (not public.is_viewer())', t.relname);
    execute format('drop policy if exists viewer_no_update on public.%I', t.relname);
    execute format('create policy viewer_no_update on public.%I as restrictive for update to authenticated using (not public.is_viewer()) with check (not public.is_viewer())', t.relname);
    execute format('drop policy if exists viewer_no_delete on public.%I', t.relname);
    execute format('create policy viewer_no_delete on public.%I as restrictive for delete to authenticated using (not public.is_viewer())', t.relname);
  end loop;
end $$;

-- 4) 사진 (pm-photos 보관함): 보기 전용은 사진 보기만
drop policy if exists viewer_photos_read on storage.objects;
create policy viewer_photos_read on storage.objects for select to authenticated using (bucket_id = 'pm-photos' and public.is_viewer());
drop policy if exists viewer_photos_no_insert on storage.objects;
create policy viewer_photos_no_insert on storage.objects as restrictive for insert to authenticated with check (not public.is_viewer());
drop policy if exists viewer_photos_no_update on storage.objects;
create policy viewer_photos_no_update on storage.objects as restrictive for update to authenticated using (not public.is_viewer());
drop policy if exists viewer_photos_no_delete on storage.objects;
create policy viewer_photos_no_delete on storage.objects as restrictive for delete to authenticated using (not public.is_viewer());

notify pgrst, 'reload schema';
select '완료' as 결과;
