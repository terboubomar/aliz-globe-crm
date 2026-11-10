-- Maintenance app: branches request repairs, the maintenance team does them.
-- New roles: branch manager (sees their branch's complaints and requests
-- maintenance), maintenance manager (all requests, assigns them) and
-- technician (only the jobs assigned to them).

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('SUPER_ADMIN','MARKETING_MANAGER','SHIFT_LEAD','AGENT','OPERATIONS_MANAGER','CEO','OWNER',
    'IT_MANAGER','BRANCH_MANAGER','MAINTENANCE_MANAGER','TECHNICIAN'));
--> statement-breakpoint

-- Complaints are never visible to the maintenance team.
CREATE OR REPLACE FUNCTION public.ticket_visible(_brand text, _branch uuid, _escalated boolean, _owner text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select public.staff_in_scope(_brand, _branch) and exists (select 1 from public.current_staff() s
    where s.role not in ('IT_MANAGER', 'MAINTENANCE_MANAGER', 'TECHNICIAN')
      and (s.role <> 'OPERATIONS_MANAGER' or (_escalated and _owner = s.user_id::text)))
$$;
--> statement-breakpoint

-- Refunds stay hidden from branch managers and the maintenance team.
CREATE OR REPLACE FUNCTION public.refund_visible(_brand text, _branch uuid, _requester uuid, _ticket uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select public.staff_in_scope(_brand, _branch) and exists (select 1 from public.current_staff() s
    where s.role not in ('BRANCH_MANAGER', 'MAINTENANCE_MANAGER', 'TECHNICIAN')
      and (s.role <> 'AGENT' or s.finance_duty <> 'NONE' or _requester = s.user_id)
      and (s.role <> 'OPERATIONS_MANAGER' or exists (select 1 from public.tickets t
           where t.id = _ticket and t.escalated and t.resolution_owner = s.user_id::text)))
$$;
--> statement-breakpoint

CREATE SEQUENCE IF NOT EXISTS public.maintenance_number_seq;
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint NOT NULL UNIQUE DEFAULT nextval('public.maintenance_number_seq'),
  brand_id text NOT NULL REFERENCES public.brands(id),
  branch_id uuid NOT NULL,
  category text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('URGENT', 'HIGH', 'NORMAL')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'NEW' CHECK (state IN ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CONFIRMED', 'CANCELLED')),
  requester uuid NOT NULL,
  assignee uuid,
  respond_due_at timestamptz,
  fix_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz,
  started_at timestamptz,
  done_at timestamptz,
  confirmed_at timestamptz,
  version int NOT NULL DEFAULT 1,
  FOREIGN KEY (branch_id, brand_id) REFERENCES public.branches(id, brand_id)
);
CREATE INDEX IF NOT EXISTS maintenance_requests_scope ON public.maintenance_requests (brand_id, branch_id, state);
CREATE INDEX IF NOT EXISTS maintenance_requests_assignee ON public.maintenance_requests (assignee, state);

CREATE TABLE IF NOT EXISTS public.maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE RESTRICT,
  type text NOT NULL,
  actor text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maintenance_events_request ON public.maintenance_events (request_id, created_at);

CREATE TABLE IF NOT EXISTS public.maintenance_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('BEFORE', 'AFTER')),
  storage_key text NOT NULL UNIQUE,
  size int NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS maintenance_events_append_only ON public.maintenance_events;
CREATE TRIGGER maintenance_events_append_only BEFORE UPDATE OR DELETE ON public.maintenance_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();
DROP TRIGGER IF EXISTS maintenance_requests_no_delete ON public.maintenance_requests;
CREATE TRIGGER maintenance_requests_no_delete BEFORE DELETE ON public.maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();
--> statement-breakpoint

-- Who sees a request: managers and viewers in scope, the branch manager of
-- that branch, and a technician only when the job is theirs.
CREATE OR REPLACE FUNCTION public.maintenance_visible(_brand text, _branch uuid, _assignee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select public.staff_in_scope(_brand, _branch) and exists (select 1 from public.current_staff() s
    where s.role in ('SUPER_ADMIN', 'MAINTENANCE_MANAGER', 'BRANCH_MANAGER', 'OPERATIONS_MANAGER', 'CEO', 'OWNER')
       or (s.role = 'TECHNICIAN' and _assignee = s.user_id))
$$;

ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scoped maintenance read" ON public.maintenance_requests;
CREATE POLICY "scoped maintenance read" ON public.maintenance_requests FOR SELECT TO authenticated
  USING (public.maintenance_visible(brand_id, branch_id, assignee));
DROP POLICY IF EXISTS "scoped maintenance event read" ON public.maintenance_events;
CREATE POLICY "scoped maintenance event read" ON public.maintenance_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.maintenance_requests m WHERE m.id = request_id));
DROP POLICY IF EXISTS "scoped maintenance photo read" ON public.maintenance_photos;
CREATE POLICY "scoped maintenance photo read" ON public.maintenance_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.maintenance_requests m WHERE m.id = request_id));

REVOKE ALL ON public.maintenance_requests, public.maintenance_events, public.maintenance_photos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.maintenance_requests, public.maintenance_events, public.maintenance_photos FROM authenticated;
GRANT SELECT ON public.maintenance_requests, public.maintenance_events, public.maintenance_photos TO authenticated;
REVOKE ALL ON SEQUENCE public.maintenance_number_seq FROM anon, authenticated;
--> statement-breakpoint

-- Every change is one transaction: the request, its event and the audit row.
CREATE OR REPLACE FUNCTION public.maintenance_create_tx(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare r public.maintenance_requests;
begin
  if not exists (select 1 from public.branches where id = (p->>'branch_id')::uuid and brand_id = p->>'brand_id' and active) then
    raise exception 'INVALID_BRANCH';
  end if;
  insert into public.maintenance_requests(brand_id, branch_id, category, priority, title, description, requester, respond_due_at, fix_due_at)
  values (p->>'brand_id', (p->>'branch_id')::uuid, p->>'category', p->>'priority', p->>'title', coalesce(p->>'description', ''),
          (p->>'requester')::uuid, (p->>'respond_due_at')::timestamptz, (p->>'fix_due_at')::timestamptz)
  returning * into r;
  insert into public.maintenance_events(request_id, type, actor, note) values (r.id, 'CREATED', p->>'requester', null);
  perform public.write_audit(p->>'requester', 'MAINTENANCE_CREATED', r.id::text);
  return jsonb_build_object('id', r.id, 'number', r.number);
end $$;

CREATE OR REPLACE FUNCTION public.maintenance_action_tx(_id uuid, _version int, p jsonb, _type text, _note text, _actor text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare r public.maintenance_requests;
begin
  select * into r from public.maintenance_requests where id = _id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.version <> _version then raise exception 'CONFLICT'; end if;
  update public.maintenance_requests set
    state = coalesce(p->>'state', state),
    assignee = case when p ? 'assignee' then (p->>'assignee')::uuid else assignee end,
    assigned_at = case when p ? 'assigned_at' then (p->>'assigned_at')::timestamptz else assigned_at end,
    started_at = case when p ? 'started_at' then (p->>'started_at')::timestamptz else started_at end,
    done_at = case when p ? 'done_at' then (p->>'done_at')::timestamptz else done_at end,
    confirmed_at = case when p ? 'confirmed_at' then (p->>'confirmed_at')::timestamptz else confirmed_at end,
    version = version + 1
  where id = _id;
  insert into public.maintenance_events(request_id, type, actor, note) values (_id, _type, _actor, _note);
  perform public.write_audit(_actor, 'MAINTENANCE_' || _type, _id::text);
end $$;

REVOKE EXECUTE ON FUNCTION public.maintenance_create_tx(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.maintenance_action_tx(uuid, int, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintenance_create_tx(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.maintenance_action_tx(uuid, int, jsonb, text, text, text) TO service_role;
