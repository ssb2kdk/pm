-- =====================================================================
-- 44번 파일: 폐수처리 위탁비용 1공장·2공장 배분 (환경일지 「위탁비용 배분」 탭)
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨, 이미 넣은 달은 안 덮어씀)
--  - 달마다 한 줄: 1공장·2공장 폐수 배출량(톤) + 계약 항목 금액(인건비·약품비·분석비·운영수수료) + 추가 비용
--  - 배분 비율: 2공장 % = 반올림(2공장 ÷ 합계 × 100), 1공장 % = 100 − 2공장 % (엑셀 장표와 같음)
--  - 공장별 항목 금액 = 계약 항목 금액 × 공장 비율 (+ 그 공장 추가 비용)
--  - 관리자만 보기·고치기 (비용 정보). 바꾼 기록은 변경 기록(audit)에 남음
--  - 2025-12 ~ 2026-10 은 엑셀(2026년 순수본 폐수배출처리시설 위탁비용 배분 내역)에서 옮겨 넣음
-- =====================================================================
create table if not exists public.ww_contract (
  ym          text primary key check (ym ~ '^\d{4}-\d{2}$'),   -- 'YYYY-MM'
  t1          numeric,                -- 1공장 배출량 (톤/월)
  t2          numeric,                -- 2공장 배출량 (톤/월)
  labor       numeric,                -- 계약 인건비 (1+2공장, 원/월)
  chem        numeric,                -- 계약 약품비
  anal        numeric,                -- 계약 측정(분석)비
  fee         numeric,                -- 계약 제경비(운영수수료)
  p1_holiday  numeric, p1_chem_add numeric, p1_anal_add numeric, p1_maint numeric,  -- 1공장 추가: 휴일 수당·추가 약품비·추가 측정비·유지보수비
  p2_holiday  numeric, p2_chem_add numeric, p2_anal_add numeric, p2_maint numeric,  -- 2공장 추가
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

alter table public.ww_contract enable row level security;
revoke all on public.ww_contract from anon;
drop policy if exists ww_contract_all on public.ww_contract;
create policy ww_contract_all on public.ww_contract for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 변경 기록 (21번 파일의 audit_row 함수가 있을 때만)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'audit_row') and not exists (select 1 from pg_trigger where tgname = 'ww_contract_audit') then
    execute 'create trigger ww_contract_audit after insert or update or delete on public.ww_contract for each row execute function public.audit_row(''ym'')';
  end if;
end $$;

-- 엑셀에서 옮겨 넣기 (이미 있는 달은 그대로 둠)
insert into public.ww_contract (ym, t1, t2, labor, chem, anal, fee) values
  ('2025-12', 1592.3, 327, 4780000, 3670000, 670000, 880000),
  ('2026-01', 2065, 362,  4780000, 3670000, 670000, 880000),
  ('2026-02', 1615, 367,  4780000, 3670000, 670000, 880000),
  ('2026-03', 1975, 535,  4780000, 3670000, 670000, 880000),
  ('2026-04', 1681, 681,  4780000, 3670000, 670000, 880000),
  ('2026-05', 1698, 864,  4780000, 3670000, 670000, 880000),
  ('2026-06', 2028, 1217, 4780000, 3670000, 670000, 880000),
  ('2026-07', 1883, 1014, 4780000, 3670000, 670000, 880000),
  ('2026-08', 1638, 770,  4780000, 3670000, 670000, 880000),
  ('2026-09', 1781, 965,  4780000, 3670000, 670000, 880000),
  ('2026-10', 1887, 907,  4780000, 3670000, 670000, 880000)
on conflict (ym) do nothing;

notify pgrst, 'reload schema';
select ym, t1, t2, labor + chem + anal + fee as 계약합계 from public.ww_contract order by ym;
