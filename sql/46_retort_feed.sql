-- =====================================================================
-- 46번 파일: 생산 웹페이지 등 다른 시스템이 레토르트 값을 "읽기만" 해 가는 창구
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨)
--  - 로그인 없이, 아래 "읽기용 키"만 있으면 레토르트 최신값·기간값을 읽을 수 있음 (쓰기·수정은 불가)
--  - 수집 프로그램 비밀문자(25번)와는 다른 키를 씀 → 생산팀에 이 키만 알려주면 됨
--  - 실행 전에 아래 '여기에_읽기용_키' 를 원하는 문자(영문·숫자 20자 이상 권장)로 바꿔서 실행
--    키를 바꾸고 싶으면 이 부분만 바꿔서 다시 실행 (예전 키는 바로 막힘)
--  - 사용법(생산 웹 개발자용): retort/FEED.md
-- =====================================================================
create table if not exists public.retort_feed_key (k int primary key default 1 check (k = 1), key text not null);
insert into public.retort_feed_key(k, key) values (1, '여기에_읽기용_키') on conflict (k) do update set key = excluded.key;
alter table public.retort_feed_key enable row level security;   -- 정책 없음 = 아무도 직접 못 봄
revoke all on public.retort_feed_key from anon, authenticated;

create or replace function public.retort_feed_ok(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.retort_feed_key where key = p_key and key <> '여기에_읽기용_키' and length(key) >= 8);
$$;
revoke all on function public.retort_feed_ok(text) from public, anon, authenticated;

-- 최신값: 레토르트별 마지막 1건 (+ 이름, 몇 초 전 값인지)
create or replace function public.retort_feed_latest(p_key text)
returns table(unit_id text, name text, ts timestamptz, age_sec int,
              tc real, pc real, t1 real, t2 real, t3 real, t4 real, fo1 real, fo2 real, fo3 real, fo4 real)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.retort_feed_ok(p_key) then raise exception 'denied'; end if;
  return query
  select u.id, u.name, r.ts, extract(epoch from now() - r.ts)::int,
         r.tc, r.pc, r.t1, r.t2, r.t3, r.t4, r.fo1, r.fo2, r.fo3, r.fo4
  from public.retort_units u
  left join lateral (select * from public.retort_readings x where x.unit_id = u.id and x.ts > now() - interval '30 days'
                     order by x.ts desc limit 1) r on true
  order by u.ord;
end $$;
revoke all on function public.retort_feed_latest(text) from public;
grant execute on function public.retort_feed_latest(text) to anon, authenticated;

-- 기간값: p_sec 초 단위로 묶음 (온도·압력 = 평균, Fo = 최댓값). 한 번에 최대 31일
create or replace function public.retort_feed_series(p_key text, p_unit text, p_from timestamptz, p_to timestamptz, p_sec int default 60)
returns table(ts timestamptz, tc real, pc real, t1 real, t2 real, t3 real, t4 real, fo1 real, fo2 real, fo3 real, fo4 real)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.retort_feed_ok(p_key) then raise exception 'denied'; end if;
  if p_to - p_from > interval '31 days' then raise exception 'range too long (max 31 days)'; end if;
  return query
  select to_timestamp(floor(extract(epoch from r.ts) / greatest(p_sec, 10)) * greatest(p_sec, 10)),
         avg(r.tc)::real, avg(r.pc)::real, avg(r.t1)::real, avg(r.t2)::real, avg(r.t3)::real, avg(r.t4)::real,
         max(r.fo1), max(r.fo2), max(r.fo3), max(r.fo4)
  from public.retort_readings r
  where r.unit_id = p_unit and r.ts >= p_from and r.ts < p_to
  group by 1 order by 1;
end $$;
revoke all on function public.retort_feed_series(text, text, timestamptz, timestamptz, int) from public;
grant execute on function public.retort_feed_series(text, text, timestamptz, timestamptz, int) to anon, authenticated;

notify pgrst, 'reload schema';
select '완료' as 결과;
