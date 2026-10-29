-- =====================================================================
-- 39번 파일: 주요 생산설비 스페어(예비품) 재고 관리
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 데이터는 안 지워짐)
--  - spare_items: 품목 (분류·자재코드(BR-1)·기존 코드·품목명·규격·보관 장소·랙·단위·단가·안전재고·사진·비고)
--  - spare_moves: 입고·출고 기록 → 재고 = 입고 합 − 출고 합
--  - 시설팀 계정(관리자·일반): 보기·등록·입출고 · 품목 삭제: 관리자 · 입출고 기록 삭제: 관리자 또는 적은 본인
--  - 보기 전용·협력업체: 못 봄 · 사진은 pm-photos 저장소의 spare/ 폴더
--  - 바꾼 기록은 변경 기록(audit)에 자동으로 남음
-- =====================================================================
create table if not exists public.spare_items (
  id         bigserial primary key,
  code1      text not null default '',            -- 분류 (BR 베어링, EL 전기·제어 …)
  code2      text not null default '',            -- 자재코드 (분류-번호, 예: BR-1)
  old_code   text not null default '',            -- 기존 코드 (회사 프로그램)
  name       text not null,                       -- 품목명
  spec       text not null default '',            -- 규격
  equipment  text not null default '',            -- 사용 설비
  place      text not null default '',            -- 보관 장소
  rack       text not null default '',            -- 랙 번호
  unit       text not null default 'EA',
  price      numeric,                             -- 단가 (원)
  safety     numeric,                             -- 안전 재고
  note       text not null default '',
  photos     text[] not null default '{}',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.spare_moves (
  id         bigserial primary key,
  item_id    bigint not null references public.spare_items(id) on delete cascade,
  d          date not null default ((now() at time zone 'Asia/Seoul')::date),
  kind       text not null check (kind in ('입고', '출고')),
  qty        numeric not null check (qty > 0),
  memo       text not null default '',
  by_name    text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
-- 예전에 이 파일을 먼저 실행했어도 칸이 생기게
alter table public.spare_items add column if not exists old_code text not null default '';

create index if not exists spare_moves_item on public.spare_moves (item_id, d);

alter table public.spare_items enable row level security;
alter table public.spare_moves enable row level security;
revoke all on public.spare_items, public.spare_moves from anon;
grant select, insert, update, delete on public.spare_items, public.spare_moves to authenticated;
grant usage, select on sequence public.spare_items_id_seq, public.spare_moves_id_seq to authenticated;

drop policy if exists spare_items_select on public.spare_items;
create policy spare_items_select on public.spare_items for select to authenticated using (public.is_active_user());
drop policy if exists spare_items_insert on public.spare_items;
create policy spare_items_insert on public.spare_items for insert to authenticated with check (public.is_active_user());
drop policy if exists spare_items_update on public.spare_items;
create policy spare_items_update on public.spare_items for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists spare_items_delete on public.spare_items;
create policy spare_items_delete on public.spare_items for delete to authenticated using (public.is_admin());

drop policy if exists spare_moves_select on public.spare_moves;
create policy spare_moves_select on public.spare_moves for select to authenticated using (public.is_active_user());
drop policy if exists spare_moves_insert on public.spare_moves;
create policy spare_moves_insert on public.spare_moves for insert to authenticated with check (public.is_active_user());
drop policy if exists spare_moves_update on public.spare_moves;
create policy spare_moves_update on public.spare_moves for update to authenticated using (public.is_admin() or created_by = auth.uid()) with check (public.is_active_user());
drop policy if exists spare_moves_delete on public.spare_moves;
create policy spare_moves_delete on public.spare_moves for delete to authenticated using (public.is_active_user() and (public.is_admin() or created_by = auth.uid()));

-- 변경 기록 (21번 파일의 audit_row 함수가 있을 때만)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'audit_row') then
    if not exists (select 1 from pg_trigger where tgname = 'spare_items_audit') then
      execute 'create trigger spare_items_audit after insert or update or delete on public.spare_items for each row execute function public.audit_row(''id'')';
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'spare_moves_audit') then
      execute 'create trigger spare_moves_audit after insert or update or delete on public.spare_moves for each row execute function public.audit_row(''id'')';
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
select '완료' as 결과;
