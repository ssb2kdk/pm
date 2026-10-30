-- =====================================================================
-- 43번 파일: 레토르트 2·3호기 추가 + 기록계 IP를 DB에서 관리
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨)
--  - retort_units 에 ip 칸 추가. 수집 프로그램(collector.py)이 이 목록을 10분마다 읽어 감
--  - 4호기가 들어오면 아래 insert 에 한 줄 더 넣고 다시 실행하면 끝 (수집 프로그램 파일은 안 바꿔도 됨)
--      ('retort_4', '레토르트4', 4, '192.168.254.4')
--  - 잠시 수집을 빼고 싶은 레토르트는 ip 를 비우면 (null) 수집 프로그램이 건너뜀
-- =====================================================================
alter table public.retort_units add column if not exists ip text;

insert into public.retort_units(id, name, ord, ip) values
  ('retort_1', '레토르트1', 1, '192.168.254.1'),
  ('retort_2', '레토르트2', 2, '192.168.254.2'),
  ('retort_3', '레토르트3', 3, '192.168.254.3')
on conflict (id) do update set name = excluded.name, ord = excluded.ord, ip = excluded.ip;

-- 수집 프로그램이 레토르트 목록(id, ip)을 받아 가는 문 (비밀문자가 맞아야만)
create or replace function public.retort_units_for_collector(p_secret text)
returns table(id text, ip text) language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.load_secret where secret = p_secret) then raise exception 'denied'; end if;
  return query select u.id, u.ip from public.retort_units u where coalesce(u.ip, '') <> '' order by u.ord;
end $$;
revoke all on function public.retort_units_for_collector(text) from public;
grant execute on function public.retort_units_for_collector(text) to anon, authenticated;

notify pgrst, 'reload schema';
select id, name, ip from public.retort_units order by ord;
