-- 31. 설비별 부하: 1분 기록은 「오늘」만, 지난 날은 10분 요약 + 하루 kWh·가동시간은 1분 기록으로 미리 계산해 보관
--  · 매일 새벽 3시 30분: 어제까지의 1분 기록 → (kWh·가동시간 1분 단위로 확정) → 10분 요약으로 줄이고 1분 기록 삭제
--  · 가동시간은 「설정」의 가동 기준(A) 기준으로 계산 → 기준을 나중에 바꾸면 지난 날은 10분 평균으로 다시 계산됨
--    (그래서 가동 기준은 정리 전에 먼저 넣어 두는 게 좋음)
--  · 30번 SQL 을 먼저 실행해 두어야 함

-- ① 하루 가동시간 보관표
create table if not exists public.load_run_day (
  d date not null, panel_id text not null, ch int not null, on_a real,
  run_min numeric, first_on timestamptz, last_off timestamptz, starts int, max_a real,
  primary key (d, panel_id, ch)
);
alter table public.load_run_day enable row level security;
drop policy if exists load_run_day_r on public.load_run_day;
create policy load_run_day_r on public.load_run_day for select to authenticated using (public.load_ok());

-- ② 하루 가동시간 계산 (1분 기록이 있으면 1분 단위, 없으면 10분 평균)
create or replace function public.load_run_build(p_d date)
returns void language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := (p_d::timestamp at time zone 'Asia/Seoul');
begin
  delete from public.load_run_day where d = p_d;
  insert into public.load_run_day(d, panel_id, ch, on_a, run_min, first_on, last_off, starts, max_a)
  select p_d, c.panel_id, c.ch, c.on_a, coalesce(y.run_min, 0), y.first_on, y.last_off, coalesce(y.starts, 0), y.max_a
  from public.load_channels c
  left join (
    select x.panel_id, x.ch,
           round(sum(case when x.on_ then
             case when x.nts is not null and extract(epoch from (x.nts - x.ts)) <= 600 then extract(epoch from (x.nts - x.ts)) / 60
                  when x.h then 10 else 1 end else 0 end)::numeric, 0) as run_min,
           min(x.ts) filter (where x.on_) as first_on,
           max(coalesce(x.nts, x.ts + case when x.h then interval '10 minutes' else interval '1 minute' end)) filter (where x.on_) as last_off,
           count(*) filter (where x.on_ and coalesce(x.prev_on, false) = false)::int as starts,
           max(x.m) as max_a
    from (
      select s.panel_id, s.ts, s.h, v.ch, v.a, coalesce(v.m, v.a) as m, (v.a >= c2.on_a) as on_,
             lag(v.a >= c2.on_a) over w as prev_on, lead(s.ts) over w as nts
      from (
        select r.ts, r.panel_id, false as h, r.ch0 a0, r.ch1 a1, r.ch2 a2, null::real m0, null::real m1, null::real m2
          from public.load_readings r where r.ts >= t0 and r.ts < t0 + interval '1 day'
        union all
        select hh.ts, hh.panel_id, true, hh.av0, hh.av1, hh.av2, hh.mx0, hh.mx1, hh.mx2
          from public.load_hist hh where hh.ts >= t0 and hh.ts < t0 + interval '1 day'
      ) s
      cross join lateral (values (0, s.a0, s.m0), (1, s.a1, s.m1), (2, s.a2, s.m2)) v(ch, a, m)
      join public.load_channels c2 on c2.panel_id = s.panel_id and c2.ch = v.ch and c2.on_a is not null
      window w as (partition by s.panel_id, v.ch order by s.ts)
    ) x group by x.panel_id, x.ch
  ) y on y.panel_id = c.panel_id and y.ch = c.ch
  where c.on_a is not null;
end $$;
revoke all on function public.load_run_build(date) from public, anon, authenticated;

-- ③ 화면에서 부르는 것: 기간의 하루 가동시간 (오늘·안 끝난 날·가동 기준이 바뀐 날만 그 자리에서 다시 계산)
create or replace function public.load_run_get(p_from date, p_to date)
returns table(d date, panel_id text, ch int, run_min numeric, first_on timestamptz, last_off timestamptz, starts int, max_a real)
language plpgsql security definer set search_path = public as $$
declare x date; k int := 0; td date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.load_ok() then raise exception 'denied'; end if;
  for x in select g::date from generate_series(p_from, least(p_to, td), interval '1 day') g loop
    if x >= td or exists (
         select 1 from public.load_channels c where c.on_a is not null and not exists (
           select 1 from public.load_run_day r where r.d = x and r.panel_id = c.panel_id and r.ch = c.ch and r.on_a = c.on_a)) then
      perform public.load_run_build(x); k := k + 1;
      exit when k > 40;
    end if;
  end loop;
  return query select r.d, r.panel_id, r.ch, r.run_min, r.first_on, r.last_off, r.starts, r.max_a
    from public.load_run_day r join public.load_channels c on c.panel_id = r.panel_id and c.ch = r.ch and c.on_a is not null
    where r.d between p_from and p_to order by 1, 2, 3;
end $$;
grant execute on function public.load_run_get(date, date) to authenticated;

-- ④ 줄이기: 이제 기본은 「오늘만 1분 기록」(p_keep = 0). 지우기 전에 kWh·가동시간을 1분 기록으로 확정
create or replace function public.load_compact(p_keep int default 0, p_max int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cut date := (now() at time zone 'Asia/Seoul')::date - greatest(p_keep, 0); x date; t0 timestamptz; k int := 0; del bigint := 0; c bigint; left_ int;
begin
  if auth.uid() is not null and not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin') then
    raise exception '관리자만 실행할 수 있습니다';
  end if;
  for x in select distinct (r.ts at time zone 'Asia/Seoul')::date from public.load_readings r
           where r.ts < (cut::timestamp at time zone 'Asia/Seoul') order by 1 limit p_max loop
    t0 := (x::timestamp at time zone 'Asia/Seoul');
    perform public.load_day_build(x);   -- kWh: 1분 기록으로 확정
    perform public.load_run_build(x);   -- 가동시간: 1분 기록으로 확정
    insert into public.load_hist(panel_id, ts, mx0, mx1, mx2, av0, av1, av2, n)
    select r.panel_id, to_timestamp(floor(extract(epoch from r.ts) / 600) * 600),
           max(r.ch0), max(r.ch1), max(r.ch2), avg(r.ch0), avg(r.ch1), avg(r.ch2), count(*)
    from public.load_readings r where r.ts >= t0 and r.ts < t0 + interval '1 day'
    group by 1, 2
    on conflict (panel_id, ts) do update set mx0 = excluded.mx0, mx1 = excluded.mx1, mx2 = excluded.mx2,
      av0 = excluded.av0, av1 = excluded.av1, av2 = excluded.av2, n = excluded.n;
    delete from public.load_readings r where r.ts >= t0 and r.ts < t0 + interval '1 day';
    get diagnostics c = row_count; del := del + c; k := k + 1;
  end loop;
  select count(distinct (r.ts at time zone 'Asia/Seoul')::date) into left_ from public.load_readings r where r.ts < (cut::timestamp at time zone 'Asia/Seoul');
  return jsonb_build_object('days', k, 'deleted', del, 'left_days', left_, 'cut', cut);
end $$;
grant execute on function public.load_compact(int, int) to authenticated;

-- ⑤ 하루 요약 화면용(load_day_get): 다시 계산할 때 가동시간도 같이
create or replace function public.load_day_get(p_from date, p_to date)
returns table(d date, panel_id text, ch int, amin numeric, avg_a real, max_a real, n int)
language plpgsql security definer set search_path = public as $$
declare x date; k int := 0;
begin
  if not public.load_ok() then raise exception 'denied'; end if;
  for x in select g::date from generate_series(p_from, least(p_to, (now() at time zone 'Asia/Seoul')::date), interval '1 day') g loop
    if not exists (select 1 from public.load_day_done where dd = x and built_at > ((x + 1)::timestamp at time zone 'Asia/Seoul') + interval '5 minutes') then
      perform public.load_day_build(x); k := k + 1;
      exit when k > 40;
    end if;
  end loop;
  return query select l.d, l.panel_id, l.ch, l.amin, l.avg_a, l.max_a, l.n from public.load_day l
    where l.d between p_from and p_to order by 1, 2, 3;
end $$;

-- ⑥ CSV 백업: 1분 기록이 있으면 1분, 없으면 10분 요약(최댓값·평균)
create or replace function public.load_csv(p_d date)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(line, E'\n' order by ts, pid), '') from (
    select r.ts, r.panel_id pid, to_char(r.ts at time zone 'Asia/Seoul', 'YYYY-MM-DD,HH24:MI:SS') || ',' || r.panel_id || ',' ||
           coalesce(r.ch0::text, '') || ',' || coalesce(r.ch1::text, '') || ',' || coalesce(r.ch2::text, '') || ',,,,1분' as line
      from public.load_readings r
      where r.ts >= (p_d::timestamp at time zone 'Asia/Seoul') and r.ts < (p_d::timestamp at time zone 'Asia/Seoul') + interval '1 day'
    union all
    select h.ts, h.panel_id, to_char(h.ts at time zone 'Asia/Seoul', 'YYYY-MM-DD,HH24:MI:SS') || ',' || h.panel_id || ',' ||
           coalesce(h.mx0::text, '') || ',' || coalesce(h.mx1::text, '') || ',' || coalesce(h.mx2::text, '') || ',' ||
           coalesce(round(h.av0::numeric, 2)::text, '') || ',' || coalesce(round(h.av1::numeric, 2)::text, '') || ',' || coalesce(round(h.av2::numeric, 2)::text, '') || ',10분'
      from public.load_hist h
      where h.ts >= (p_d::timestamp at time zone 'Asia/Seoul') and h.ts < (p_d::timestamp at time zone 'Asia/Seoul') + interval '1 day'
  ) t where public.load_ok();
$$;


-- ⑧ 데이터 누락 구간 (정전·쉘리 꺼짐·인터넷 문제): 분전반별로 5분 넘게(10분 요약 구간은 20분 넘게) 기록이 빈 시간
create table if not exists public.load_gap (
  d date not null, panel_id text not null, g_from timestamptz not null, g_to timestamptz not null, minutes int,
  primary key (d, panel_id, g_from)
);
alter table public.load_gap enable row level security;
drop policy if exists load_gap_r on public.load_gap;
create policy load_gap_r on public.load_gap for select to authenticated using (public.load_ok());

create or replace function public.load_gap_build(p_d date)
returns void language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := (p_d::timestamp at time zone 'Asia/Seoul'); t1 timestamptz := t0 + interval '1 day'; te timestamptz := least(t0 + interval '1 day', now());
begin
  delete from public.load_gap where d = p_d;
  insert into public.load_gap(d, panel_id, g_from, g_to, minutes)
  select p_d, g.panel_id, g.a, g.b, round(extract(epoch from (g.b - g.a)) / 60)::int
  from (
    select s.panel_id, lag(s.ts) over w as a, s.ts as b, lag(s.k) over w as ka, s.k as kb
    from (
      select r.ts, r.panel_id, 0 as k from public.load_readings r where r.ts >= t0 and r.ts < t1
      union all select h.ts, h.panel_id, 1 from public.load_hist h where h.ts >= t0 and h.ts < t1
      union all select x.t, p.id, 2 from public.load_panels p cross join (values (t0), (te)) x(t)
        where exists (select 1 from public.load_readings r where r.panel_id = p.id and r.ts < t1)
           or exists (select 1 from public.load_hist h where h.panel_id = p.id and h.ts < t1)
    ) s
    window w as (partition by s.panel_id order by s.ts, s.k)
  ) g
  where g.a is not null and g.b - g.a > case when g.ka = 1 or g.kb = 1 then interval '20 minutes' else interval '5 minutes' end;
end $$;
revoke all on function public.load_gap_build(date) from public, anon, authenticated;

-- 하루 요약 계산할 때 누락 구간도 같이 (30번 내용 + 누락 계산 1줄)
create or replace function public.load_day_build(p_d date)
returns void language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := (p_d::timestamp at time zone 'Asia/Seoul');
begin
  delete from public.load_day where d = p_d;
  insert into public.load_day(d, panel_id, ch, amin, avg_a, max_a, n)
  select p_d, x.panel_id, x.ch,
         round(sum(coalesce(x.gap, 1) * coalesce(x.a, 0))::numeric, 2), avg(x.a), max(coalesce(x.m, x.a)), count(x.a)::int
  from (
    select s.panel_id, v.ch, v.a, v.m,
           case when s.w is not null then s.w
                when extract(epoch from (s.ts - lag(s.ts) over w)) <= 600 then extract(epoch from (s.ts - lag(s.ts) over w)) / 60 else 1 end as gap
    from (
      select r.ts, r.panel_id, r.ch0 a0, r.ch1 a1, r.ch2 a2, null::real m0, null::real m1, null::real m2, null::numeric w
        from public.load_readings r where r.ts >= t0 and r.ts < t0 + interval '1 day'
      union all
      select h.ts, h.panel_id, h.av0, h.av1, h.av2, h.mx0, h.mx1, h.mx2, 10
        from public.load_hist h where h.ts >= t0 and h.ts < t0 + interval '1 day'
    ) s
    cross join lateral (values (0, s.a0, s.m0), (1, s.a1, s.m1), (2, s.a2, s.m2)) v(ch, a, m)
    window w as (partition by s.panel_id, v.ch order by s.ts)
  ) x group by x.panel_id, x.ch;
  perform public.load_gap_build(p_d);
  insert into public.load_day_done(dd, built_at) values (p_d, now())
  on conflict (dd) do update set built_at = now();
end $$;
revoke all on function public.load_day_build(date) from public, anon, authenticated;

-- 지금까지 계산된 날들의 누락 구간 한 번 계산 (1분 기록이 남아 있으니 정확하게)
do $$
declare x date;
begin
  for x in select dd from public.load_day_done order by dd loop perform public.load_gap_build(x); end loop;
end $$;

-- ⑦ 자동 실행을 「오늘만 남기기」로 바꿈 (매일 새벽 3시 30분 한국시간)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'load-compact';
  perform cron.schedule('load-compact', '30 18 * * *', 'select public.load_compact(0, 400)');
  raise notice '자동 실행 변경 완료 (매일 03:30, 오늘만 1분 기록)';
exception when others then
  raise notice 'pg_cron 사용 불가(자동 실행 없음): %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
select '완료' as 결과;
