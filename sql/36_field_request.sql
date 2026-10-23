-- =====================================================================
-- 36번 파일: 업무일지 → 「현장 요청사항」으로 바꿈 (35번 표 그대로 사용)
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 데이터는 안 지워짐)
--  - 누가 쓰든 시설팀 모두가 봄 (나만 보기 없앰 — 기존 비공개 글도 이제 모두에게 보임)
--  - 담당자 지정 · 완료 예정일
--  - 고치기·완료 표시: 쓴 사람 · 담당자 · 관리자 / 지우기: 쓴 사람 · 관리자
-- =====================================================================
alter table public.work_log add column if not exists assignee uuid;
alter table public.work_log add column if not exists assignee_name text not null default '';
alter table public.work_log add column if not exists place text not null default '';   -- 위치·설비
alter table public.work_log add column if not exists done_by text not null default '';  -- 완료 처리한 사람
create index if not exists work_log_assignee on public.work_log (assignee, status);

drop policy if exists work_log_select on public.work_log;
create policy work_log_select on public.work_log for select to authenticated
  using (public.is_active_user() or public.is_viewer());
drop policy if exists work_log_insert on public.work_log;
create policy work_log_insert on public.work_log for insert to authenticated
  with check (owner = auth.uid() and public.is_active_user());
drop policy if exists work_log_update on public.work_log;
create policy work_log_update on public.work_log for update to authenticated
  using (public.is_active_user() and (owner = auth.uid() or assignee = auth.uid() or public.is_admin()))
  with check (public.is_active_user());
drop policy if exists work_log_delete on public.work_log;
create policy work_log_delete on public.work_log for delete to authenticated
  using (public.is_active_user() and (owner = auth.uid() or public.is_admin()));

notify pgrst, 'reload schema';
select '완료' as 결과;
