-- 33. (필요할 때만) 정리한 날을 1분 기록으로 되돌리기
--  · 32번 압축 보관본(load_raw_day)에서 1분 기록을 다시 꺼내 load_readings 에 넣음
--  · 그 날의 10분 요약은 지우고, kWh·가동시간·누락 구간은 1분 기록으로 다시 계산
--  · 사용법: 맨 아래 줄의 날짜를 바꿔서 실행 (예: 6월 1일 ~ 10월 21일 전부)
--  · 주의: 오늘 밤 3시 30분 자동 정리가 다시 줄이므로, 계속 1분으로 두려면 자동 정리를 끄는 줄도 같이 실행

create or replace function public.load_restore(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x date; t0 timestamptz; n bigint := 0; c bigint; k int := 0;
begin
  if auth.uid() is not null and not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin') then
    raise exception '관리자만 실행할 수 있습니다';
  end if;
  for x in select distinct d from public.load_raw_day where d between p_from and p_to order by 1 loop
    t0 := (x::timestamp at time zone 'Asia/Seoul');
    insert into public.load_readings(panel_id, ts, ch0, ch1, ch2)
    select o.panel_id, t0 + make_interval(secs => u.s), u.a0, u.a1, u.a2
    from public.load_raw_day o cross join lateral unnest(o.secs, o.c0, o.c1, o.c2) u(s, a0, a1, a2)
    where o.d = x
    on conflict do nothing;
    get diagnostics c = row_count; n := n + c;
    delete from public.load_hist h where h.ts >= t0 and h.ts < t0 + interval '1 day';
    perform public.load_day_build(x);
    perform public.load_run_build(x);
    k := k + 1;
  end loop;
  return jsonb_build_object('days', k, 'restored_rows', n);
end $$;
revoke all on function public.load_restore(date, date) from public, anon, authenticated;

-- ▼ 되돌릴 기간 (날짜만 바꿔서 실행)
select public.load_restore('2026-06-01', '2026-10-21');

-- ▼ 계속 1분 기록으로 두려면 자동 정리 끄기 (필요할 때만 앞의 -- 를 지우고 실행)
-- select cron.unschedule('load-compact');
