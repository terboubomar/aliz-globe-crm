-- "Other" fault type: the requester writes what the issue is.
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS category_detail text;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.maintenance_create_tx(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare r public.maintenance_requests;
begin
  if not exists (select 1 from public.branches where id = (p->>'branch_id')::uuid and brand_id = p->>'brand_id' and active) then
    raise exception 'INVALID_BRANCH';
  end if;
  insert into public.maintenance_requests(brand_id, branch_id, category, category_detail, priority, title, description, requester, respond_due_at, fix_due_at)
  values (p->>'brand_id', (p->>'branch_id')::uuid, p->>'category', nullif(p->>'category_detail', ''), p->>'priority', p->>'title',
          coalesce(p->>'description', ''), (p->>'requester')::uuid, (p->>'respond_due_at')::timestamptz, (p->>'fix_due_at')::timestamptz)
  returning * into r;
  insert into public.maintenance_events(request_id, type, actor, note) values (r.id, 'CREATED', p->>'requester', null);
  perform public.write_audit(p->>'requester', 'MAINTENANCE_CREATED', r.id::text);
  return jsonb_build_object('id', r.id, 'number', r.number);
end $$;
REVOKE EXECUTE ON FUNCTION public.maintenance_create_tx(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintenance_create_tx(jsonb) TO service_role;
