-- =====================================================================
-- 40번 파일: 회사 프로그램 스페어 목록 52개 옮기기 (2026-10-29 파일)
-- 먼저 39번 파일(수정본)을 실행한 뒤 → 이 파일 전체 붙여넣기 → Run
--  - 자재코드는 분류별 번호로 새로 붙음 (분류 안에서는 예전 S번호 순서) · 예전 S번호는 「기존 코드」에 남음
--  - 「재고 수량」은 2026-10-29 날짜로 「기초 재고」 입고 기록이 들어감
--  - 단가 0은 「모름」으로 보고 비워 둠 · 등록일(예전 자재코드 1차)은 등록 일시로 넣음
--  - 같은 기존 코드(S001 등)가 이미 있으면 건너뜀 → 여러 번 실행해도 두 번 안 들어감
-- 분류: BR 2개, BT 2개, EL 1개, ET 2개, HT 4개, MT 1개, PK 24개, PN 1개, SL 15개
-- =====================================================================
with src (cat, old, name, spec, place, rack, unit, price, safety, stock, reg) as (values
  ('PK', 'S052', 'bottom open pad', '9-rb0024-11-01', '외포장실', 'a1', 'EA', 3500::numeric, 10::numeric, 90::numeric, date '2026-10-19'),
  ('MT', 'S051', '크레인 주행 모터', '0.5kw 6p 16:1', '외포장실', '', 'EA', null::numeric, 1::numeric, 2::numeric, date '2026-08-13'),
  ('PK', 'S050', '컵피더컵 사각', 'fc 3kg용 사각 서스컵', '외포장실', 'b1', 'EA', null::numeric, 1::numeric, 5::numeric, date '2026-08-13'),
  ('PK', 'S049', '컵피더 컵 소', '더블 미니용', '외포장실', 'b1', 'EA', null::numeric, 1::numeric, 5::numeric, date '2026-08-13'),
  ('PK', 'S048', '컵피더 컵 대', '중형', '외포장실', 'b1', 'EA', null::numeric, 1::numeric, 8::numeric, date '2026-08-13'),
  ('PK', 'S047', '로타리 3kg 피스톤', '소스충진 피스톤', '외포장실', 'b5', 'EA', null::numeric, 1::numeric, 2::numeric, date '2026-08-13'),
  ('PK', 'S046', '로타리 3kg 노즐', '소스충진 노즐', '외포장실', 'b5', 'EA', null::numeric, 1::numeric, 2::numeric, date '2026-08-13'),
  ('HT', 'S045', 'hopper heater sensor', '5100-hp3025-01-01', '외포장실', 'a5', 'EA', 35000::numeric, 1::numeric, 3::numeric, date '2026-08-13'),
  ('HT', 'S044', 'hopper heater', '5100-hp3214-01-01', '외포장실', 'a5', 'EA', 10000::numeric, 1::numeric, 3::numeric, date '2026-08-13'),
  ('SL', 'S043', 'quad-ring', '5111-cy1101-02-01', '외포장실', 'a4', 'EA', 5000::numeric, 1::numeric, 6::numeric, date '2026-08-13'),
  ('SL', 'S042', 'wear ring', 'spcmmn-155', '외포장실', 'a4', 'EA', 35000::numeric, 1::numeric, 3::numeric, date '2026-08-13'),
  ('SL', 'S041', 'mupu seal 30423-1200-40-s', 'spcmmn-375', '외포장실', 'a4', 'EA', 110000::numeric, 1::numeric, 2::numeric, date '2026-08-13'),
  ('SL', 'S040', 'mupu seal 30422-0450-40-s', 'spcmmn-77', '외포장실', 'a4', 'EA', 40000::numeric, 1::numeric, 2::numeric, date '2026-08-13'),
  ('SL', 'S039', 'mupu seal 30422-0350-40-s', 'spcmmn-278', '외포장실', 'a4', 'EA', 35000::numeric, 1::numeric, 2::numeric, date '2026-08-13'),
  ('SL', 'S038', 'mupu seal 30412-0250-40-h', 'spcmmn-163', '외포장실', 'a3', 'EA', 30000::numeric, 1::numeric, 3::numeric, date '2026-08-13'),
  ('SL', 'S037', 'o-ring g-60', 'spcmmn-179', '외포장실', 'a3', 'EA', 1000::numeric, 1::numeric, 12::numeric, date '2026-08-13'),
  ('SL', 'S036', 'o-ring p-50', 'spcmmn-309', '외포장실', 'a3', 'EA', 500::numeric, 1::numeric, 2::numeric, date '2026-08-13'),
  ('SL', 'S035', 'o-ring g-45', 'spcmmn-94', '외포장실', 'a3', 'EA', 500::numeric, 1::numeric, 8::numeric, date '2026-08-13'),
  ('SL', 'S034', 'o-ring p-42', 'spcmmn-300', '외포장실', 'a3', 'EA', 500::numeric, 1::numeric, 12::numeric, date '2026-08-13'),
  ('SL', 'S033', 'o-ring p-14', 'spcmmn-69', '외포장실', 'a3', 'EA', 300::numeric, 1::numeric, 6::numeric, date '2026-08-13'),
  ('SL', 'S032', 'o-ring p-10', 'spcmmn-104', '외포장실', 'a2', 'EA', 300::numeric, 1::numeric, 8::numeric, date '2026-08-13'),
  ('SL', 'S031', 'o-ring p-21', 'spcmmn-342', '외포장실', 'a2', 'EA', 300::numeric, 1::numeric, 6::numeric, date '2026-08-13'),
  ('SL', 'S030', 'mupu seal 30411-0150-40-h', 'spcmmn-33', '외포장실', 'a2', 'EA', 30000::numeric, 1::numeric, 4::numeric, date '2026-08-13'),
  ('SL', 'S029', 'o-ring s-2', 'spcmmn-538', '외포장실', 'a2', 'EA', 100::numeric, 1::numeric, 30::numeric, date '2026-08-13'),
  ('PK', 'S028', 'gripper jaw', '9-ct0128-01-01', '외포장실', 'a2', 'EA', 10000::numeric, 1::numeric, 15::numeric, date '2026-08-13'),
  ('EL', 'S027', 'relay', 'spcmmn-524', '외포장실', 'a2', 'EA', 10000::numeric, 3::numeric, 3::numeric, date '2026-08-13'),
  ('PN', 'S026', 'solvalve', 'spcmmn-238', '외포장실', 'a2', 'EA', 60000::numeric, 2::numeric, 3::numeric, date '2026-08-13'),
  ('PK', 'S025', 'joint', '5130-nb0025-01-01', '외포장실', 'a1', 'EA', 40000::numeric, 2::numeric, 6::numeric, date '2026-08-13'),
  ('ET', 'S024', 'key', 'spcmmn-44', '외포장실', 'a1', 'EA', 5000::numeric, 1::numeric, 3::numeric, date '2026-08-13'),
  ('BR', 'S023', 'lever bearing oil nipple', 'spcmmn-89', '외포장실', 'a1', 'EA', 3000::numeric, 5::numeric, 20::numeric, date '2026-08-13'),
  ('BR', 'S022', 'follow pin bearing', '1000-ba0027-01-02', '외포장실', 'a1', 'EA', 60000::numeric, 2::numeric, 6::numeric, date '2026-08-13'),
  ('PK', 'S021', 'base lever spring (s)', '1000-ba0024-01-01', '외포장실', 'a1', 'EA', 20000::numeric, 2::numeric, 6::numeric, date '2026-08-13'),
  ('PK', 'S020', 'base lever spring (l)', '1000-ba0024-02-02', '외포장실', 'a1', 'EA', 25000::numeric, 2::numeric, 3::numeric, date '2026-08-13'),
  ('PK', 'S019', 'neutral gripper spring', '17u4-ng0021-01-05', '외포장실', 'a1', 'EA', 20000::numeric, 4::numeric, 4::numeric, date '2026-08-13'),
  ('PK', 'S018', 'clamp spring', '1000-gp0018-08-01', '외포장실', 'a1', 'EA', 15000::numeric, 4::numeric, 12::numeric, date '2026-08-13'),
  ('PK', 'S017', 'seal bar spanner', '1000-x20020-01-01', '외포장실', 'a1', 'EA', 10000::numeric, 1::numeric, 3::numeric, date '2026-08-13'),
  ('PK', 'S016', 'gripper spring pin', '1000-gp0120-01-01', '외포장실', 'a1', 'EA', 5000::numeric, 16::numeric, 24::numeric, date '2026-08-13'),
  ('PK', 'S015', 'gripper spring (s)', '1000-gp0020-02-01', '외포장실', 'a1', 'EA', 10000::numeric, 8::numeric, 12::numeric, date '2026-08-13'),
  ('ET', 'S014', 'teflon tape', 'spcmmn-395', '외포장실', 'a1', 'EA', 35000::numeric, 2::numeric, 2::numeric, date '2026-08-13'),
  ('HT', 'S013', 'heater temperature sensor', '1000-sl0030-10-03', '외포장실', 'a1', 'EA', 30000::numeric, 3::numeric, 2::numeric, date '2026-08-13'),
  ('PK', 'S012', 'sealbar spring', '1000-sl0025-41-01', '외포장실', 'a1', 'EA', 15000::numeric, 4::numeric, 5::numeric, date '2026-08-13'),
  ('HT', 'S011', 'sealing heater', '1000-sl0029-11-02', '외포장실', 'a1', 'EA', 60000::numeric, 4::numeric, 6::numeric, date '2026-08-13'),
  ('PK', 'S010', 'sealing bar pin', '1000-sl0018-01-02', '외포장실', 'a1', 'EA', 20000::numeric, 2::numeric, 8::numeric, date '2026-08-13'),
  ('PK', 'S009', 'neutral gripper roller', '17u4-ng0011-01-01', '외포장실', 'a1', 'EA', null::numeric, 8::numeric, 8::numeric, date '2026-08-13'),
  ('PK', 'S008', 'gripper roller', '1000-gp0008-01-01', '외포장실', 'a1', 'EA', 5000::numeric, 8::numeric, 20::numeric, date '2026-08-13'),
  ('PK', 'S007', 'bag clip pad', '9-rb0003-01-01', '외포장실', 'a1', 'EA', 2000::numeric, 10::numeric, 60::numeric, date '2026-08-13'),
  ('PK', 'S006', 'bottom open pad', '9-rb0028-11-01', '외포장실', 'a1', 'EA', 3500::numeric, 10::numeric, 60::numeric, date '2026-08-13'),
  ('PK', 'S005', 'bag open pad', '9-rb0023-61-01', '외포장실', 'a1', 'EA', 3500::numeric, 10::numeric, 90::numeric, date '2026-08-13'),
  ('PK', 'S004', 'magazine brush pad (L)', '9-rb0001-11-01', '외포장실', 'a1', 'EA', 12000::numeric, 4::numeric, 16::numeric, date '2026-08-13'),
  ('PK', 'S003', 'magazine vacuum pad', '9-RB0026-61-02', '외포장실', 'a1', 'EA', 3500::numeric, 10::numeric, 127::numeric, date '2026-08-13'),
  ('BT', 'S002', 'induction motor belt', 'spcmmn-181', '외포장실', 'a1', 'EA', 3000::numeric, 2::numeric, 3::numeric, date '2026-08-13'),
  ('BT', 'S001', 'magazine feeding belt', 'spcmmn-169', '외포장실', 'a1', 'EA', 4000::numeric, 8::numeric, 16::numeric, date '2026-08-13')
),
todo as (
  select s.*, row_number() over (partition by s.cat order by s.old) as rn
  from src s
  where not exists (select 1 from public.spare_items i where i.old_code = s.old or i.code2 = s.old)
),
ins as (
  insert into public.spare_items (code1, code2, old_code, name, spec, place, rack, unit, price, safety, created_at)
  select t.cat,
         t.cat || '-' || (coalesce((select max(substring(i.code2 from '-(\d+)$')::int) from public.spare_items i where i.code2 ~ ('^' || t.cat || '-\d+$')), 0) + t.rn),
         t.old, t.name, t.spec, t.place, t.rack, t.unit, t.price, t.safety, t.reg::timestamptz
  from todo t
  returning id, old_code
)
insert into public.spare_moves (item_id, d, kind, qty, memo, by_name)
select ins.id, date '2026-10-29', '입고', s.stock, '기초 재고 (회사 프로그램에서 옮겨옴)', '강동경'
from ins join src s on s.old = ins.old_code
where s.stock > 0;

select code1 as 분류, count(*) as 품목수, code1 || '-' || max(substring(code2 from '-(\d+)$')::int) as 마지막_코드 from public.spare_items where old_code ~ '^S\d+$' group by code1 order by 1;
