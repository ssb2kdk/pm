-- 29. 설비별 부하: 하루 요약표(빠르게 보기) + 시간 검색 색인
-- 옛 기록이 100만 줄 넘게 들어가서 kWh·변화 찾기가 시간 초과 → 하루마다 미리 계산해 두고 그걸 읽음
-- (실행 시간: 수십 초 걸릴 수 있음 — 맨 아래에서 지난 기록 전부 한 번 계산)

-- ① 시각으로 찾는 색인 (기간 그래프도 빨라짐)
create index if not exists load_readings_ts_idx on public.load_readings(ts);

-- ② 하루 요약: 채널별 A·분 합계(=전류×측정 분), 평균·최대 전류, 건수
--    kWh 는 화면에서 A·분 × (√3 × 전압 × 역률 ÷ 1000) ÷ 60 으로 계산 → 설정(전압·역률)을 바꿔도 다시 계산할 필요 없음
create table if not exists public.load_day (
  d date not null, panel_id text not null, ch int not null,
  amin numeric, avg_a real, max_a real, n int,
  primary key (d, panel_id, ch)
);
create table if not exists public.load_day_done (dd date primary key, built_at timestamptz not null default now());
alter table public.load_day enable row level security;
alter table public.load_day_done enable row level security;
drop policy if exists load_day_r on public.load_day;
create policy load_day_r on public.load_day for select to authenticated using (public.load_ok());

-- ③ 하루치 다시 계산 (측정 간격: 10분 이하는 실제 간격, 넘게 끊기면 1분만 인정 — 예전 kWh 계산과 같음)
create or replace function public.load_day_build(p_d date)
returns void language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := (p_d::timestamp at time zone 'Asia/Seoul');
begin
  delete from public.load_day where d = p_d;
  insert into public.load_day(d, panel_id, ch, amin, avg_a, max_a, n)
  select p_d, x.panel_id, x.ch,
         round(sum(coalesce(x.gap, 1) * coalesce(x.a, 0))::numeric, 2), avg(x.a), max(x.a), count(x.a)::int
  from (
    select r.panel_id, v.ch, v.a,
           case when extract(epoch from (r.ts - lag(r.ts) over w)) <= 600 then extract(epoch from (r.ts - lag(r.ts) over w)) / 60 else 1 end as gap
    from public.load_readings r
    cross join lateral (values (0, r.ch0), (1, r.ch1), (2, r.ch2)) v(ch, a)
    where r.ts >= t0 and r.ts < t0 + interval '1 day'
    window w as (partition by r.panel_id, v.ch order by r.ts)
  ) x group by x.panel_id, x.ch;
  insert into public.load_day_done(dd, built_at) values (p_d, now())
  on conflict (dd) do update set built_at = now();
end $$;
revoke all on function public.load_day_build(date) from public, anon, authenticated;

-- ④ 화면에서 부르는 것: 기간의 하루 요약을 돌려줌. 아직 안 끝난 날(오늘·계산 후 하루가 안 지난 날)만 그 자리에서 다시 계산
create or replace function public.load_day_get(p_from date, p_to date)
returns table(d date, panel_id text, ch int, amin numeric, avg_a real, max_a real, n int)
language plpgsql security definer set search_path = public as $$
declare x date; k int := 0;
begin
  if not public.load_ok() then raise exception 'denied'; end if;
  for x in select g::date from generate_series(p_from, least(p_to, (now() at time zone 'Asia/Seoul')::date), interval '1 day') g loop
    if not exists (select 1 from public.load_day_done where dd = x and built_at > ((x + 1)::timestamp at time zone 'Asia/Seoul') + interval '5 minutes') then
      perform public.load_day_build(x); k := k + 1;
      exit when k > 40;   -- 한 번에 너무 많이 계산하지 않도록 (나머지는 다음에)
    end if;
  end loop;
  return query select l.d, l.panel_id, l.ch, l.amin, l.avg_a, l.max_a, l.n from public.load_day l
    where l.d between p_from and p_to order by 1, 2, 3;
end $$;
grant execute on function public.load_day_get(date, date) to authenticated;

-- ⑤ 지난 기록 전부 한 번 계산 (처음 한 번만, 수십 초 걸릴 수 있음)
do $$
declare x date; a date; b date;
begin
  select (min(ts) at time zone 'Asia/Seoul')::date, (max(ts) at time zone 'Asia/Seoul')::date into a, b from public.load_readings;
  if a is null then return; end if;
  for x in select g::date from generate_series(a, b, interval '1 day') g loop perform public.load_day_build(x); end loop;
end $$;

notify pgrst, 'reload schema';
select count(*) as 계산된_줄, min(d) as 처음, max(d) as 마지막 from public.load_day;
