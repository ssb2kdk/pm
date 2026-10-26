-- =====================================================================
-- 37번 파일: 유틸리티 분석 「특이사항」(부하 변동 포함)을 시설팀 일반 계정도 적을 수 있게
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨)
--  - 특이사항은 ut_monthly 의 ym = '9999-00' 한 줄에 모아 저장됨 → 그 줄만 일반 계정도 넣고 고칠 수 있게 함
--  - 화면에서는 고치기·삭제를 쓴 사람(과 관리자)만 할 수 있게 막아 둠 · 누가 바꿨는지는 변경 기록에 남음
--  - 목표·예산 등 다른 연도 자료('YYYY-00')는 지금처럼 관리자만
-- =====================================================================
drop policy if exists ut_monthly_notes_insert on public.ut_monthly;
create policy ut_monthly_notes_insert on public.ut_monthly for insert to authenticated
  with check (public.is_active_user() and ym = '9999-00');
drop policy if exists ut_monthly_notes_update on public.ut_monthly;
create policy ut_monthly_notes_update on public.ut_monthly for update to authenticated
  using (public.is_active_user() and ym = '9999-00') with check (public.is_active_user() and ym = '9999-00');

notify pgrst, 'reload schema';
select '완료' as 결과;
