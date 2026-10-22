-- =====================================================================
-- 34번 파일: 자재 발주 요청 (소모품이 모자라면 사진·규격 올려 요청 → 담당자 확인·구매 → 구매 완료)
-- Supabase SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 데이터는 안 지워짐)
--  - 사진은 이미 있는 pm-photos 저장소의 mat/ 폴더에 올라갑니다 (저장소 권한은 그대로 사용)
--  - 시설팀 계정(관리자·일반): 요청 올리기·처리(확인·구매 완료) · 보기 전용: 보기만 · 협력업체: 못 봄
--  - 지우기: 관리자 또는 요청한 본인(아직 「요청」 상태일 때)
-- =====================================================================
create table if not exists public.mat_req (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  req_name   text not null default '',            -- 요청한 사람 이름
  item       text not null,                       -- 품명
  spec       text not null default '',            -- 규격·모델·사이즈
  qty        numeric,                             -- 수량
  unit       text not null default 'EA',
  place      text not null default '',            -- 어디에 쓰는지 (설비·장소)
  urgent     boolean not null default false,      -- 급함
  memo       text not null default '',
  photos     text[] not null default '{}',        -- pm-photos 안의 경로 (mat/...)
  status     text not null default '요청' check (status in ('요청', '확인', '구매완료', '반려')),
  handled_by text not null default '',            -- 처리한 사람
  checked_at timestamptz,                         -- 확인(구매 진행) 시각
  done_at    timestamptz,                         -- 구매 완료(또는 반려) 시각
  buy_memo   text not null default '',            -- 업체·금액·입고 예정 등
  price      numeric                              -- 구매 금액 (선택)
);
create index if not exists mat_req_status on public.mat_req (status, created_at desc);

alter table public.mat_req enable row level security;
revoke all on public.mat_req from anon;
grant select, insert, update, delete on public.mat_req to authenticated;
grant usage, select on sequence public.mat_req_id_seq to authenticated;

drop policy if exists mat_req_select on public.mat_req;
create policy mat_req_select on public.mat_req for select to authenticated using (public.is_active_user() or public.is_viewer());
drop policy if exists mat_req_insert on public.mat_req;
create policy mat_req_insert on public.mat_req for insert to authenticated with check (public.is_active_user());
drop policy if exists mat_req_update on public.mat_req;
create policy mat_req_update on public.mat_req for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists mat_req_delete on public.mat_req;
create policy mat_req_delete on public.mat_req for delete to authenticated
  using (public.is_admin() or (created_by = auth.uid() and status = '요청'));

notify pgrst, 'reload schema';
select '완료' as 결과;
