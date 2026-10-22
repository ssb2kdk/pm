-- 28. 설비별 부하: 옛 설정 이름 반영 + 가동시간(켠·끈 시각) + 측정 이력(쉘리 옮긴 기간)
-- ① 옛 시트 「설정」 탭 그대로 이름·기준 넣기 (이미 화면에서 바꾼 게 있으면 덮어씀)
update public.load_panels p set name = v.n, ord = v.o from (values
  ('panel_1','P-레토르트',1),('panel_2','P-냉동1',2),('panel_3','P-냉동2',3),('panel_4','P-기계1',4),('panel_5','P-기계2',5)
) v(id, n, o) where p.id = v.id;

update public.load_channels c set name = v.n, limit_a = v.l, pf = v.pf from (values
  ('panel_1',0,'레토르트칠러1',80,0.85),('panel_1',1,'레토르트칠러2',80,0.85),('panel_1',2,'레토르트칠러3',80,0.85),
  ('panel_2',0,'냉동창고1',50,0.85),('panel_2',1,'냉동창고2',50,0.85),('panel_2',2,'냉동창고3',50,0.85),
  ('panel_3',0,'냉장창고1',50,0.85),('panel_3',1,'내포장공조',50,0.85),('panel_3',2,'파쇄공조',50,0.85),
  ('panel_4',0,'관류보일러1',100,0.85),('panel_4',1,'관류보일러2',100,0.85),('panel_4',2,'상수가압펌프',10,0.85),
  ('panel_5',0,'에어컴프레셔1',70,0.85),('panel_5',1,'에어컴프레셔2',70,0.85),('panel_5',2,'전기온수기',70,1)
) v(p, ch, n, l, pf) where c.panel_id = v.p and c.ch = v.ch;

-- ② 가동 기준 전류: 이 값 이상이면 「돌고 있음」 (비워 두면 가동시간 계산 안 함)
alter table public.load_channels add column if not exists on_a real;

-- ③ 측정 이력: 쉘리를 옮겨 다른 설비를 잰 기간 (그 기간 그래프·표에 이 이름이 나옴)
create table if not exists public.load_assign (
  id bigserial primary key, panel_id text not null references public.load_panels(id) on delete cascade,
  ch int not null check (ch between 0 and 2), d_from date not null, d_to date, name text not null, memo text
);
alter table public.load_assign enable row level security;
drop policy if exists load_assign_r on public.load_assign;
create policy load_assign_r on public.load_assign for select to authenticated using (public.load_ok());
drop policy if exists load_assign_w on public.load_assign;
create policy load_assign_w on public.load_assign for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin'));

-- ④ 하루별 가동시간: 기준 전류 이상인 시간(분), 처음 켠 시각, 마지막 끈 시각, 켠 횟수
--    측정 간격은 실제 간격(10분 넘게 끊기면 1분만 인정) — kWh 계산과 같은 방식
create or replace function public.load_runtime(p_from timestamptz, p_to timestamptz)
returns table(d date, panel_id text, ch int, run_min numeric, first_on timestamptz, last_off timestamptz, starts int, max_a real)
language sql stable security definer set search_path = public as $$
  with x as (
    select r.panel_id, r.ts, v.ch, v.a, c.on_a,
           (v.a >= c.on_a) as on_,
           lag(v.a >= c.on_a) over (partition by r.panel_id, v.ch order by r.ts) as prev_on,
           lead(r.ts) over (partition by r.panel_id, v.ch order by r.ts) as nts
    from public.load_readings r
    cross join lateral (values (0, r.ch0), (1, r.ch1), (2, r.ch2)) v(ch, a)
    join public.load_channels c on c.panel_id = r.panel_id and c.ch = v.ch
    where public.load_ok() and c.on_a is not null and r.ts >= p_from and r.ts < p_to
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
grant execute on function public.load_runtime(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
select '완료' as 결과;
