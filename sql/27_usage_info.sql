-- 27. 저장공간 사용량 보기 (홈 화면 「저장공간」, 관리자만)
-- DB 전체 크기, 표별 크기·건수, 사진 저장소(Storage) 크기, 부하 기록 하루 증가량
create or replace function public.usage_info()
returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
declare r jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin') then
    raise exception '관리자만 볼 수 있습니다';
  end if;
  select jsonb_build_object(
    'db', pg_database_size(current_database()),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'bytes', pg_total_relation_size(c.oid), 'rows', greatest(c.reltuples, 0)::bigint)
                 order by pg_total_relation_size(c.oid) desc), '[]'::jsonb)
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind = 'r'),
    'storage', (select coalesce(jsonb_agg(jsonb_build_object('bucket', s.bucket_id, 'bytes', s.b, 'files', s.n)), '[]'::jsonb)
                from (select bucket_id, sum(coalesce((metadata->>'size')::bigint, 0)) b, count(*) n from storage.objects group by bucket_id) s),
    'load_day', (select count(*) from public.load_readings where ts > now() - interval '1 day')
  ) into r;
  return r;
end $$;
grant execute on function public.usage_info() to authenticated;

notify pgrst, 'reload schema';
select '완료' as 결과;
