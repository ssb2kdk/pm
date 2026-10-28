-- =====================================================================
-- 38번 파일: 전기 직무고시 일지 (연간 점검 계획표 · 월차 점검 · 저압 절연저항/누설전류 · 저압 접지저항 · 고압 설비 · 변압기)
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 데이터는 안 지워짐)
--  - 일지 하나 = 한 줄 (kind = 종류, d = 점검일, data = 입력값 묶음)
--  - 시설팀 계정(관리자·일반): 보기·적기·고치기 · 지우기: 관리자 또는 쓴 본인 · 보기 전용·협력업체: 못 봄
--  - 바꾼 기록은 변경 기록(audit)에 자동으로 남음
-- =====================================================================
create table if not exists public.elec_logs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('plan', 'monthly', 'lvins', 'lvgnd', 'hv', 'tr')),
  d          date not null,
  data       jsonb not null default '{}'::jsonb,
  by_name    text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists elec_logs_kind_d on public.elec_logs (kind, d desc);

alter table public.elec_logs enable row level security;
revoke all on public.elec_logs from anon;
grant select, insert, update, delete on public.elec_logs to authenticated;

drop policy if exists elec_logs_select on public.elec_logs;
create policy elec_logs_select on public.elec_logs for select to authenticated using (public.is_active_user());
drop policy if exists elec_logs_insert on public.elec_logs;
create policy elec_logs_insert on public.elec_logs for insert to authenticated with check (public.is_active_user());
drop policy if exists elec_logs_update on public.elec_logs;
create policy elec_logs_update on public.elec_logs for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists elec_logs_delete on public.elec_logs;
create policy elec_logs_delete on public.elec_logs for delete to authenticated
  using (public.is_active_user() and (public.is_admin() or created_by = auth.uid()));

-- 변경 기록 (21번 파일의 audit_row 함수가 있을 때만)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'audit_row') and not exists (select 1 from pg_trigger where tgname = 'elec_logs_audit') then
    execute 'create trigger elec_logs_audit after insert or update or delete on public.elec_logs for each row execute function public.audit_row(''id'')';
  end if;
end $$;

notify pgrst, 'reload schema';
select '완료' as 결과;
