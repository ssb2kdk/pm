-- =====================================================================
-- 42번 파일: 지금 연결된 기록계는 레토르트1 → 이름·번호를 retort_2(레토르트2) → retort_1(레토르트1) 로 바꿈
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨)
--  - 지금까지 쌓인 기록도 레토르트1 로 옮김
--  - 수집 프로그램(collector.py)도 retort_1 로 바뀐 새 파일로 바꿔야 함
-- =====================================================================
insert into public.retort_units(id, name, ord) values ('retort_1', '레토르트1', 1)
  on conflict (id) do update set name = excluded.name, ord = excluded.ord;

update public.retort_readings set unit_id = 'retort_1' where unit_id = 'retort_2';

delete from public.retort_units u where u.id = 'retort_2'
  and not exists (select 1 from public.retort_readings r where r.unit_id = 'retort_2');

select id, name, (select count(*) from public.retort_readings r where r.unit_id = u.id) as 기록수
from public.retort_units u order by ord;
