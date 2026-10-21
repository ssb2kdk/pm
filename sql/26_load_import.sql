-- 26. 설비별 부하: 예전 구글시트 기록 옮기기용 (여러 건 한 번에 넣기)
-- 비밀문자(25번에 넣은 것)가 맞아야만 들어감. 같은 분전반·같은 시각이 이미 있으면 건너뜀.
-- p_rows 예: [{"p":"panel_1","t":"2026-08-01T00:01:00+09:00","a":12.3,"b":11.8,"c":12.0}, ...]
create or replace function public.load_import(p_secret text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from public.load_secret where secret = p_secret) then raise exception 'denied'; end if;
  insert into public.load_readings(panel_id, ts, ch0, ch1, ch2)
  select x->>'p', date_trunc('second', (x->>'t')::timestamptz),
         nullif(x->>'a','')::real, nullif(x->>'b','')::real, nullif(x->>'c','')::real
  from jsonb_array_elements(p_rows) x
  where exists (select 1 from public.load_panels p where p.id = x->>'p') and (x->>'t') is not null
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.load_import(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
select '완료' as 결과;
