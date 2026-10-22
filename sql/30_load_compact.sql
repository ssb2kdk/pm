-- 30. 설비별 부하: 오래된 1분 기록을 10분 요약으로 줄이기 (용량 약 1/7)
--  · 최근 60일은 1분 기록 그대로, 그보다 오래된 날은 10분마다 최댓값·평균값만 남김
--  · 지우기 전에 그날 kWh(하루 요약표 load_day)를 1분 기록으로 정확히 계산해 둠 → kWh는 그대로 유지
--  · 기간 그래프는 오래된 날을 10분 단위로 보여 줌 (최댓값이라 피크는 그대로 보임)
--  · 매일 새벽 3시 30분 자동 실행 (pg_cron) + 「설정」 탭에서 직접 실행·월별 백업(CSV) 가능

-- ① 10분 요약 표
create table if not exists public.load_hist (
  panel_id text not null, ts timestamptz not null,
  mx0 real, mx1 real, mx2 real, av0 real, av1 real, av2 real, n smallint,
  primary key (panel_id, ts)
);
create index if not exists load_hist_ts_idx on public.load_hist(ts);
alter table public.load_hist enable row level security;
drop policy if exists load_hist_r on public.load_hist;
create policy load_hist_r on public.load_hist for select to authenticated using (public.load_ok());

-- ② 기간 그래프: 1분 기록 + 10분 요약(최댓값)을 합쳐서
create or replace function public.load_series(p_from timestamptz, p_to timestamptz, p_bucket int default 1)
returns table(ts timestamptz, panel_id text, ch0 real, ch1 real, ch2 real)
language sql stable security definer set search_path = public as $$
  select to_timestamp(floor(extract(epoch from t.ts) / (greatest(p_bucket,1) * 60)) * greatest(p_bucket,1) * 60),
         t.panel_id, max(t.c0), max(t.c1), max(t.c2)
  from (
    select r.ts, r.panel_id, r.ch0 c0, r.ch1 c1, r.ch2 c2 from public.load_readings r where r.ts >= p_from and r.ts < p_to
    union all
    select h.ts, h.panel_id, h.mx0, h.mx1, h.mx2 from public.load_hist h where h.ts >= p_from and h.ts < p_to
  ) t
  where public.load_ok()
  group by 1, 2 order by 1;
$$;

-- ③ 하루 요약 계산: 10분 요약만 남은 날도 계산되게 (평균값 × 10분)
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
  insert into public.load_day_done(dd, built_at) values (p_d, now())
  on conflict (dd) do update set built_at = now();
end $$;
revoke all on function public.load_day_build(date) from public, anon, authenticated;

-- ④ 가동시간: 10분 요약만 남은 날은 평균 전류로 판단 (10분 단위)
create or replace function public.load_runtime(p_from timestamptz, p_to timestamptz)
returns table(d date, panel_id text, ch int, run_min numeric, first_on timestamptz, last_off timestamptz, starts int, max_a real)
language sql stable security definer set search_path = public as $$
  with s as (
    select r.ts, r.panel_id, r.ch0 a0, r.ch1 a1, r.ch2 a2 from public.load_readings r where r.ts >= p_from and r.ts < p_to
    union all
    select h.ts, h.panel_id, h.av0, h.av1, h.av2 from public.load_hist h where h.ts >= p_from and h.ts < p_to
  ), x as (
    select s.panel_id, s.ts, v.ch, v.a, (v.a >= c.on_a) as on_,
           lag(v.a >= c.on_a) over (partition by s.panel_id, v.ch order by s.ts) as prev_on,
           lead(s.ts) over (partition by s.panel_id, v.ch order by s.ts) as nts
    from s cross join lateral (values (0, s.a0), (1, s.a1), (2, s.a2)) v(ch, a)
    join public.load_channels c on c.panel_id = s.panel_id and c.ch = v.ch
    where public.load_ok() and c.on_a is not null
  )
  select (x.ts at time zone 'Asia/Seoul')::date, x.panel_id, x.ch,
         round(sum(case when x.on_ then
           case when x.nts is not null and extract(epoch from (x.nts - x.ts)) <= 600 then extract(epoch from (x.nts - x.ts)) / 60 else 1 end
           else 0 end)::numeric, 0),
         min(x.ts) filter (where x.on_),
         max(coalesce(x.nts, x.ts)) filter (where x.on_),
         count(*) filter (where x.on_ and coalesce(x.prev_on, false) = false)::int,
         max(x.a)
  from x group by 1, 2, 3 order by 1, 2, 3;
$$;

-- ⑤ 줄이기: p_keep 일보다 오래된 날을 하루씩 (한 번에 최대 p_max 일)
create or replace function public.load_compact(p_keep int default 60, p_max int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cut date := (now() at time zone 'Asia/Seoul')::date - greatest(p_keep, 14); x date; t0 timestamptz; k int := 0; del bigint := 0; c bigint; left_ int;
begin
  if auth.uid() is not null and not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin') then
    raise exception '관리자만 실행할 수 있습니다';
  end if;
  for x in select distinct (r.ts at time zone 'Asia/Seoul')::date from public.load_readings r
           where r.ts < (cut::timestamp at time zone 'Asia/Seoul') order by 1 limit p_max loop
    t0 := (x::timestamp at time zone 'Asia/Seoul');
    perform public.load_day_build(x);   -- 지우기 전에 1분 기록으로 kWh 확정
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

-- ⑥ 하루치 1분 기록을 CSV 글자로 (월별 백업 받기용 — 화면에서 하루씩 받아 합침)
create or replace function public.load_csv(p_d date)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(to_char(r.ts at time zone 'Asia/Seoul', 'YYYY-MM-DD,HH24:MI:SS') || ',' || r.panel_id || ',' ||
         coalesce(r.ch0::text, '') || ',' || coalesce(r.ch1::text, '') || ',' || coalesce(r.ch2::text, ''), E'\n' order by r.ts, r.panel_id), '')
  from public.load_readings r
  where public.load_ok() and r.ts >= (p_d::timestamp at time zone 'Asia/Seoul') and r.ts < (p_d::timestamp at time zone 'Asia/Seoul') + interval '1 day';
$$;
grant execute on function public.load_csv(date) to authenticated;

-- ⑦ 매일 새벽 3시 30분(한국) 자동 실행 — pg_cron 을 못 쓰면 알림만 나오고 넘어감 (그땐 「설정」 탭에서 직접 실행)
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'load-compact';
  perform cron.schedule('load-compact', '30 18 * * *', 'select public.load_compact(60, 400)');
  raise notice '자동 실행 등록 완료';
exception when others then
  raise notice 'pg_cron 사용 불가(자동 실행 없음): %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
select '완료' as 결과;
