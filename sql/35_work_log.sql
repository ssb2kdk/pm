-- =====================================================================
-- 35번 파일: 업무일지 (담당자 개인 일지 · 원하는 것만 시설 전체 공유 · 완료 예정일)
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 데이터는 안 지워짐)
--  - 내 일지: 쓴 본인만 봄 (관리자도 남의 비공개 일지는 못 봄)
--  - 「시설 공유」를 켠 것만 시설팀 전체(관리자·일반·보기 전용)가 봄 · 고치기·지우기는 쓴 본인만
--  - 협력업체 계정은 못 봄
-- =====================================================================
create table if not exists public.work_log (
  id         bigserial primary key,
  owner      uuid not null default auth.uid(),
  owner_name text not null default '',
  d          date not null default ((now() at time zone 'Asia/Seoul')::date),  -- 업무 날짜
  title      text not null,
  body       text not null default '',
  cat        text not null default '',              -- 분류 (자유)
  status     text not null default '진행' check (status in ('진행', '완료', '보류')),
  due        date,                                  -- 완료 예정일
  done_at    timestamptz,
  shared     boolean not null default false,        -- 시설 전체 공유
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_log_owner on public.work_log (owner, d desc);
create index if not exists work_log_shared on public.work_log (shared, due);

alter table public.work_log enable row level security;
revoke all on public.work_log from anon;
grant select, insert, update, delete on public.work_log to authenticated;
grant usage, select on sequence public.work_log_id_seq to authenticated;

drop policy if exists work_log_select on public.work_log;
create policy work_log_select on public.work_log for select to authenticated
  using (owner = auth.uid() or (shared and (public.is_active_user() or public.is_viewer())));
drop policy if exists work_log_insert on public.work_log;
create policy work_log_insert on public.work_log for insert to authenticated
  with check (owner = auth.uid() and public.is_active_user());
drop policy if exists work_log_update on public.work_log;
create policy work_log_update on public.work_log for update to authenticated
  using (owner = auth.uid() and public.is_active_user()) with check (owner = auth.uid());
drop policy if exists work_log_delete on public.work_log;
create policy work_log_delete on public.work_log for delete to authenticated
  using (owner = auth.uid() and public.is_active_user());

notify pgrst, 'reload schema';
select '완료' as 결과;
