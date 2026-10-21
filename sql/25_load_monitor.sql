-- =====================================================================
-- 25번 파일: 설비별 부하 모니터링 (Shelly 전류 → Supabase)
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 됨)
-- ※ 아래 '여기에_비밀번호' 를 쉘리 전용 비밀문자(아무 영문·숫자 20자 이상)로 바꾼 뒤 실행하세요.
--   (같은 문자를 쉘리 스크립트의 SECRET 에도 넣습니다)
-- =====================================================================

create table if not exists public.load_panels (
  id text primary key, name text not null, ord int default 0
);
create table if not exists public.load_channels (
  panel_id text references public.load_panels(id) on delete cascade,
  ch int not null check (ch between 0 and 2),
  name text not null default '', limit_a numeric default 0,
  voltage numeric default 380, phase int default 3, pf numeric default 0.85, ord int default 0,
  primary key (panel_id, ch)
);
create table if not exists public.load_readings (
  panel_id text not null, ts timestamptz not null default now(),
  ch0 real, ch1 real, ch2 real,
  primary key (panel_id, ts)
);
create index if not exists load_readings_ts on public.load_readings (ts);
create table if not exists public.load_secret (k int primary key default 1 check (k = 1), secret text not null);

insert into public.load_secret(k, secret) values (1, '여기에_비밀번호') on conflict (k) do update set secret = excluded.secret;

-- 기본 분전반·채널 (이미 있으면 건드리지 않음). 이름·기준은 화면(설정)에서 고침
insert into public.load_panels(id, name, ord) values
 ('panel_1','분전반1',1),('panel_2','분전반2',2),('panel_3','분전반3',3),('panel_4','분전반4',4),('panel_5','분전반5',5)
on conflict do nothing;
insert into public.load_channels(panel_id, ch, name, ord)
select p.id, c.ch, 'CH' || c.ch, c.ch from public.load_panels p, (values (0),(1),(2)) c(ch)
on conflict do nothing;

alter table public.load_panels enable row level security;
alter table public.load_channels enable row level security;
alter table public.load_readings enable row level security;
alter table public.load_secret enable row level security;   -- 정책 없음 = 아무도 직접 못 봄

create or replace function public.load_ok() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin','user','viewer'));
$$;
revoke execute on function public.load_ok() from public, anon;
grant execute on function public.load_ok() to authenticated;

drop policy if exists load_panels_r on public.load_panels;
create policy load_panels_r on public.load_panels for select to authenticated using (public.load_ok());
drop policy if exists load_channels_r on public.load_channels;
create policy load_channels_r on public.load_channels for select to authenticated using (public.load_ok());
drop policy if exists load_readings_r on public.load_readings;
create policy load_readings_r on public.load_readings for select to authenticated using (public.load_ok());
-- 설정 수정은 관리자만 (보기 전용·협력업체 불가)
drop policy if exists load_channels_w on public.load_channels;
create policy load_channels_w on public.load_channels for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and active and role='admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and active and role='admin'));
drop policy if exists load_panels_w on public.load_panels;
create policy load_panels_w on public.load_panels for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and active and role='admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and active and role='admin'));

-- 쉘리가 값을 넣는 문 (비밀문자가 맞아야만 들어감)
create or replace function public.load_ingest(p_secret text, p_panel text, p_ch0 real, p_ch1 real, p_ch2 real)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.load_secret where secret = p_secret) then raise exception 'denied'; end if;
  if not exists (select 1 from public.load_panels where id = p_panel) then raise exception 'unknown panel'; end if;
  insert into public.load_readings(panel_id, ts, ch0, ch1, ch2)
  values (p_panel, date_trunc('second', now()), p_ch0, p_ch1, p_ch2) on conflict do nothing;
end $$;
grant execute on function public.load_ingest(text,text,real,real,real) to anon, authenticated;

-- 그래프용: 구간을 p_bucket 분 단위로 묶어 최댓값(피크 유지)
create or replace function public.load_series(p_from timestamptz, p_to timestamptz, p_bucket int default 1)
returns table(ts timestamptz, panel_id text, ch0 real, ch1 real, ch2 real)
language sql stable security definer set search_path = public as $$
  select to_timestamp(floor(extract(epoch from r.ts) / (greatest(p_bucket,1) * 60)) * greatest(p_bucket,1) * 60),
         r.panel_id, max(r.ch0), max(r.ch1), max(r.ch2)
  from public.load_readings r
  where public.load_ok() and r.ts >= p_from and r.ts < p_to
  group by 1, 2 order by 1;
$$;
grant execute on function public.load_series(timestamptz,timestamptz,int) to authenticated;

-- 최신값 (분전반별 마지막 1건)
create or replace function public.load_latest()
returns table(ts timestamptz, panel_id text, ch0 real, ch1 real, ch2 real)
language sql stable security definer set search_path = public as $$
  select distinct on (r.panel_id) r.ts, r.panel_id, r.ch0, r.ch1, r.ch2
  from public.load_readings r where public.load_ok() and r.ts > now() - interval '30 days'
  order by r.panel_id, r.ts desc;
$$;
grant execute on function public.load_latest() to authenticated;

-- 전력량(kWh): 채널별 kW(=전류×계수) × 측정 간격. 간격 10분 이하는 실제 간격, 초과(끊김)는 1분만 인정
create or replace function public.load_energy(p_from timestamptz, p_to timestamptz)
returns table(d date, panel_id text, ch int, kwh numeric)
language sql stable security definer set search_path = public as $$
  with x as (
    select r.panel_id, r.ts,
           least(case when extract(epoch from (r.ts - lag(r.ts) over (partition by r.panel_id order by r.ts))) <= 600
                      then extract(epoch from (r.ts - lag(r.ts) over (partition by r.panel_id order by r.ts))) / 60 else 1 end, 10) as gap,
           v.ch, v.a
    from public.load_readings r
    cross join lateral (values (0, r.ch0), (1, r.ch1), (2, r.ch2)) v(ch, a)
    where public.load_ok() and r.ts >= p_from and r.ts < p_to
  )
  select (x.ts at time zone 'Asia/Seoul')::date, x.panel_id, x.ch,
         round(sum(coalesce(x.gap,1) * coalesce(x.a,0) *
           case when c.phase = 1 then c.voltage * c.pf / 1000 else 1.7320508 * c.voltage * c.pf / 1000 end / 60)::numeric, 2)
  from x join public.load_channels c on c.panel_id = x.panel_id and c.ch = x.ch
  group by 1, 2, 3 order by 1, 2, 3;
$$;
grant execute on function public.load_energy(timestamptz,timestamptz) to authenticated;

notify pgrst, 'reload schema';
select '완료' as 결과;
