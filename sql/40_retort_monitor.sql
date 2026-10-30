-- =====================================================================
-- 40번 파일: 레토르트 모니터링 (온도기록계 CHINO KR2S → 수집 프로그램 → Supabase)
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨)
--  - 수집 프로그램(retort/collector.py)이 기록계 값을 읽어 retort_ingest 로 넣음
--  - 비밀문자는 25번 파일(쉘리)에서 넣은 것을 같이 씀 → 수집 프로그램 SECRET 에도 같은 문자
--  - 저장 간격은 수집 프로그램이 정함: 운전 중 10초, 쉬는 중 1분
-- =====================================================================

-- 레토르트 목록 (기록계 1대 = 1줄). 새 레토르트는 여기에 한 줄 추가
create table if not exists public.retort_units (
  id text primary key, name text not null, ord int default 0
);
insert into public.retort_units(id, name, ord) values ('retort_1', '레토르트1', 1) on conflict do nothing;

-- 기록값: 챔버 온도·압력, 온도 1~4 (TEMP_1~4), Fo 1~4
create table if not exists public.retort_readings (
  unit_id text not null references public.retort_units(id) on delete cascade,
  ts timestamptz not null,
  tc real, pc real, t1 real, t2 real, t3 real, t4 real, fo1 real, fo2 real, fo3 real, fo4 real,
  primary key (unit_id, ts)
);
create index if not exists retort_readings_ts_idx on public.retort_readings (ts);

alter table public.retort_units enable row level security;
alter table public.retort_readings enable row level security;
revoke all on public.retort_units, public.retort_readings from anon;

-- 보기: 부하 모니터링과 같은 사람들 (관리자·일반·보기 전용)
drop policy if exists retort_units_r on public.retort_units;
create policy retort_units_r on public.retort_units for select to authenticated using (public.load_ok());
drop policy if exists retort_readings_r on public.retort_readings;
create policy retort_readings_r on public.retort_readings for select to authenticated using (public.load_ok());
-- 레토르트 이름 고치기는 관리자만
drop policy if exists retort_units_w on public.retort_units;
create policy retort_units_w on public.retort_units for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and active and role='admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and active and role='admin'));

-- 수집 프로그램이 값을 넣는 문 (비밀문자가 맞아야만 들어감)
-- p_rows 예: [{"t":"2026-10-29T19:00:10+09:00","v":[10.4,1.52,14.3,13.8,13.7,15.6,14.95,15.34,15.42,15.59]}, ...]
-- 인터넷이 끊겼다 이어지면 모아둔 값을 한 번에 보냄. 같은 레토르트·같은 시각이 이미 있으면 건너뜀
create or replace function public.retort_ingest(p_secret text, p_unit text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from public.load_secret where secret = p_secret) then raise exception 'denied'; end if;
  if not exists (select 1 from public.retort_units where id = p_unit) then raise exception 'unknown unit'; end if;
  insert into public.retort_readings(unit_id, ts, tc, pc, t1, t2, t3, t4, fo1, fo2, fo3, fo4)
  select p_unit, date_trunc('second', (x->>'t')::timestamptz),
         (x->'v'->>0)::real, (x->'v'->>1)::real, (x->'v'->>2)::real, (x->'v'->>3)::real, (x->'v'->>4)::real,
         (x->'v'->>5)::real, (x->'v'->>6)::real, (x->'v'->>7)::real, (x->'v'->>8)::real, (x->'v'->>9)::real
  from jsonb_array_elements(p_rows) x
  where (x->>'t') is not null and (x->>'t')::timestamptz < now() + interval '5 minutes'
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.retort_ingest(text, text, jsonb) from public;
grant execute on function public.retort_ingest(text, text, jsonb) to anon, authenticated;

-- 최신값 (레토르트별 마지막 1건)
create or replace function public.retort_latest()
returns setof public.retort_readings
language sql stable security definer set search_path = public as $$
  select distinct on (r.unit_id) r.* from public.retort_readings r
  where public.load_ok() and r.ts > now() - interval '30 days'
  order by r.unit_id, r.ts desc;
$$;
revoke all on function public.retort_latest() from public, anon;
grant execute on function public.retort_latest() to authenticated;

-- 그래프용: p_sec 초 단위로 묶음 (온도·압력 = 평균, Fo = 최댓값)
create or replace function public.retort_series(p_from timestamptz, p_to timestamptz, p_unit text, p_sec int default 60)
returns table(ts timestamptz, tc real, pc real, t1 real, t2 real, t3 real, t4 real, fo1 real, fo2 real, fo3 real, fo4 real)
language sql stable security definer set search_path = public as $$
  select to_timestamp(floor(extract(epoch from r.ts) / greatest(p_sec, 1)) * greatest(p_sec, 1)),
         avg(r.tc)::real, avg(r.pc)::real, avg(r.t1)::real, avg(r.t2)::real, avg(r.t3)::real, avg(r.t4)::real,
         max(r.fo1), max(r.fo2), max(r.fo3), max(r.fo4)
  from public.retort_readings r
  where public.load_ok() and r.unit_id = p_unit and r.ts >= p_from and r.ts < p_to
  group by 1 order by 1;
$$;
revoke all on function public.retort_series(timestamptz, timestamptz, text, int) from public, anon;
grant execute on function public.retort_series(timestamptz, timestamptz, text, int) to authenticated;

notify pgrst, 'reload schema';
select '완료' as 결과;
