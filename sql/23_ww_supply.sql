-- =====================================================================
-- 23번 파일: 환경일지 다온산업 장부 — 「기타」 자리를 「소모품 (구매물품·금액)」으로
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨)
--  - 기존 기타 구입·사용(etc_in, etc_use) 칸은 지우지 않고 그대로 둠 (화면에서만 안 보임)
-- =====================================================================
alter table public.ww_daily add column if not exists supply_item text;
alter table public.ww_daily add column if not exists supply_amt numeric;

notify pgrst, 'reload schema';
select '완료' as 결과;
