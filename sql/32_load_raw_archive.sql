-- 32. 설비별 부하: 1분 기록 원본을 「하루 1줄」로 압축 보관 (자동 백업)
--  · 매일 새벽 정리할 때 1분 기록을 지우기 전에, 분전반별 하루치를 배열로 묶어 1줄로 보관 → 원본 그대로(손실 없음)
--  · 용량: 하루 약 0.1 MB (1분 기록 그대로 두면 하루 약 1.1 MB) → 1년 약 30~40 MB
--  · 「설정」 탭 월별 CSV 받기는 이 보관본에서 1분 기록 그대로 만들어 줌 → 언제든 지난달 1분 기록 받기 가능
--  · 31번 SQL 다음에 실행 (오늘 밤 3시 30분 자동 정리 전에)

create table if not exists public.load_raw_day (
  d date not null, panel_id text not null,
  secs int[] not null,          -- 그날 0시부터 몇 초째인지
  c0 real[], c1 real[], c2 real[],
  primary key (d, panel_id)
);
alter table public.load_raw_day enable row level security;
drop policy if exists load_raw_day_r on public.load_raw_day;
create policy load_raw_day_r on public.load_raw_day for select to authenticated using (public.load_ok());

-- 줄이기: 지우기 전에 원본을 하루 1줄로 보관하는 단계 추가 (나머지는 31번과 같음)
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
    perform public.load_day_build(x);   -- kWh·누락 구간: 1분 기록으로 확정
    perform public.load_run_build(x);   -- 가동시간: 1분 기록으로 확정
    -- 원본 보관 (이미 보관본이 있으면 합쳐서 다시 만듦)
    insert into public.load_raw_day(d, panel_id, secs, c0, c1, c2)
    select x, z.panel_id, array_agg(z.s order by z.s), array_agg(z.a0 order by z.s), array_agg(z.a1 order by z.s), array_agg(z.a2 order by z.s)
    from (
      select r.panel_id, extract(epoch from (r.ts - t0))::int s, r.ch0 a0, r.ch1 a1, r.ch2 a2
        from public.load_readings r where r.ts >= t0 and r.ts < t0 + interval '1 day'
      union
      select o.panel_id, u.s, u.a0, u.a1, u.a2 from public.load_raw_day o
        cross join lateral unnest(o.secs, o.c0, o.c1, o.c2) u(s, a0, a1, a2) where o.d = x
    ) z group by z.panel_id
    on conflict (d, panel_id) do update set secs = excluded.secs, c0 = excluded.c0, c1 = excluded.c1, c2 = excluded.c2;
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

-- CSV: 오늘 1분 기록 + 보관본(지난 날 1분 기록 그대로). 둘 다 없는 날만 10분 요약
create or replace function public.load_csv(p_d date)
returns text language sql stable security definer set search_path = public as $$
  with t0 as (select (p_d::timestamp at time zone 'Asia/Seoul') as t),
  raw as (
    select r.ts, r.panel_id pid, r.ch0 a0, r.ch1 a1, r.ch2 a2 from public.load_readings r, t0
      where r.ts >= t0.t and r.ts < t0.t + interval '1 day'
    union all
    select t0.t + make_interval(secs => u.s), o.panel_id, u.a0, u.a1, u.a2 from t0, public.load_raw_day o
      cross join lateral unnest(o.secs, o.c0, o.c1, o.c2) u(s, a0, a1, a2) where o.d = p_d
  )
  select coalesce(string_agg(line, E'\n' order by ts, pid), '') from (
    select ts, pid, to_char(ts at time zone 'Asia/Seoul', 'YYYY-MM-DD,HH24:MI:SS') || ',' || pid || ',' ||
           coalesce(a0::text, '') || ',' || coalesce(a1::text, '') || ',' || coalesce(a2::text, '') || ',,,,1분' as line from raw
    union all
    select h.ts, h.panel_id, to_char(h.ts at time zone 'Asia/Seoul', 'YYYY-MM-DD,HH24:MI:SS') || ',' || h.panel_id || ',' ||
           coalesce(h.mx0::text, '') || ',' || coalesce(h.mx1::text, '') || ',' || coalesce(h.mx2::text, '') || ',' ||
           coalesce(round(h.av0::numeric, 2)::text, '') || ',' || coalesce(round(h.av1::numeric, 2)::text, '') || ',' || coalesce(round(h.av2::numeric, 2)::text, '') || ',10분'
      from public.load_hist h, t0
      where h.ts >= t0.t and h.ts < t0.t + interval '1 day'
        and not exists (select 1 from raw where raw.pid = h.panel_id)
  ) z where public.load_ok();
$$;
grant execute on function public.load_csv(date) to authenticated;

notify pgrst, 'reload schema';
select '완료' as 결과;
