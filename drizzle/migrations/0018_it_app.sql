-- IT app: every staff member can open an IT ticket (from any department or
-- branch); the IT manager sees them all and assigns an IT specialist (new
-- role), who works only the tickets assigned to them. Requesters see their own
-- tickets. Complaints and refunds stay hidden from IT specialists.

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('SUPER_ADMIN','MARKETING_MANAGER','SHIFT_LEAD','AGENT','OPERATIONS_MANAGER','CEO','OWNER',
    'IT_MANAGER','BRANCH_MANAGER','MAINTENANCE_MANAGER','TECHNICIAN','IT_SPECIALIST'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.ticket_visible(_brand text, _branch uuid, _escalated boolean, _owner text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select public.staff_in_scope(_brand, _branch) and exists (select 1 from public.current_staff() s
    where s.role not in ('IT_MANAGER', 'IT_SPECIALIST', 'MAINTENANCE_MANAGER', 'TECHNICIAN')
      and (s.role <> 'OPERATIONS_MANAGER' or (_escalated and _owner = s.user_id::text)))
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.refund_visible(_brand text, _branch uuid, _requester uuid, _ticket uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select public.staff_in_scope(_brand, _branch) and exists (select 1 from public.current_staff() s
    where s.role not in ('BRANCH_MANAGER', 'MAINTENANCE_MANAGER', 'TECHNICIAN', 'IT_SPECIALIST')
      and (s.role <> 'AGENT' or s.finance_duty <> 'NONE' or _requester = s.user_id)
      and (s.role <> 'OPERATIONS_MANAGER' or exists (select 1 from public.tickets t
           where t.id = _ticket and t.escalated and t.resolution_owner = s.user_id::text)))
$$;
--> statement-breakpoint

CREATE SEQUENCE IF NOT EXISTS public.it_ticket_number_seq;
CREATE TABLE IF NOT EXISTS public.it_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint NOT NULL UNIQUE DEFAULT nextval('public.it_ticket_number_seq'),
  brand_id text REFERENCES public.brands(id),
  branch_id uuid,
  department text NOT NULL,
  category text NOT NULL,
  category_detail text,
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
  FOREIGN KEY (branch_id, brand_id) REFERENCES public.branches(id, brand_id),
  CHECK ((branch_id IS NULL) = (brand_id IS NULL))
);
CREATE INDEX IF NOT EXISTS it_tickets_state ON public.it_tickets (state, created_at);
CREATE INDEX IF NOT EXISTS it_tickets_requester ON public.it_tickets (requester, state);
CREATE INDEX IF NOT EXISTS it_tickets_assignee ON public.it_tickets (assignee, state);

CREATE TABLE IF NOT EXISTS public.it_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.it_tickets(id) ON DELETE RESTRICT,
  type text NOT NULL,
  actor text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS it_events_ticket ON public.it_events (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.it_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.it_tickets(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('BEFORE', 'AFTER')),
  storage_key text NOT NULL UNIQUE,
  size int NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS it_events_append_only ON public.it_events;
CREATE TRIGGER it_events_append_only BEFORE UPDATE OR DELETE ON public.it_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();
DROP TRIGGER IF EXISTS it_tickets_no_delete ON public.it_tickets;
CREATE TRIGGER it_tickets_no_delete BEFORE DELETE ON public.it_tickets
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();
--> statement-breakpoint

-- Who sees a ticket: the IT manager and super admin (all), the specialist it
-- is assigned to, and the person who opened it.
CREATE OR REPLACE FUNCTION public.it_visible(_requester uuid, _assignee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select exists (select 1 from public.current_staff() s
    where s.role in ('SUPER_ADMIN', 'IT_MANAGER')
       or _requester = s.user_id
       or (s.role = 'IT_SPECIALIST' and _assignee = s.user_id))
$$;

ALTER TABLE public.it_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.it_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.it_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scoped it read" ON public.it_tickets;
CREATE POLICY "scoped it read" ON public.it_tickets FOR SELECT TO authenticated
  USING (public.it_visible(requester, assignee));
DROP POLICY IF EXISTS "scoped it event read" ON public.it_events;
CREATE POLICY "scoped it event read" ON public.it_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.it_tickets t WHERE t.id = ticket_id));
DROP POLICY IF EXISTS "scoped it photo read" ON public.it_photos;
CREATE POLICY "scoped it photo read" ON public.it_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.it_tickets t WHERE t.id = ticket_id));

REVOKE ALL ON public.it_tickets, public.it_events, public.it_photos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.it_tickets, public.it_events, public.it_photos FROM authenticated;
GRANT SELECT ON public.it_tickets, public.it_events, public.it_photos TO authenticated;
REVOKE ALL ON SEQUENCE public.it_ticket_number_seq FROM anon, authenticated;
--> statement-breakpoint

-- Every change is one transaction: the ticket, its event and the audit row.
CREATE OR REPLACE FUNCTION public.it_create_tx(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare r public.it_tickets;
begin
  if nullif(p->>'branch_id', '') is not null and not exists (select 1 from public.branches
      where id = (p->>'branch_id')::uuid and brand_id = p->>'brand_id' and active) then
    raise exception 'INVALID_BRANCH';
  end if;
  insert into public.it_tickets(brand_id, branch_id, department, category, category_detail, priority, title, description,
                                requester, respond_due_at, fix_due_at)
  values (nullif(p->>'brand_id', ''), nullif(p->>'branch_id', '')::uuid, p->>'department', p->>'category',
          nullif(p->>'category_detail', ''), p->>'priority', p->>'title', coalesce(p->>'description', ''),
          (p->>'requester')::uuid, (p->>'respond_due_at')::timestamptz, (p->>'fix_due_at')::timestamptz)
  returning * into r;
  insert into public.it_events(ticket_id, type, actor, note) values (r.id, 'CREATED', p->>'requester', null);
  perform public.write_audit(p->>'requester', 'IT_CREATED', r.id::text);
  return jsonb_build_object('id', r.id, 'number', r.number);
end $$;

CREATE OR REPLACE FUNCTION public.it_action_tx(_id uuid, _version int, p jsonb, _type text, _note text, _actor text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare r public.it_tickets;
begin
  select * into r from public.it_tickets where id = _id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.version <> _version then raise exception 'CONFLICT'; end if;
  update public.it_tickets set
    state = coalesce(p->>'state', state),
    assignee = case when p ? 'assignee' then (p->>'assignee')::uuid else assignee end,
    assigned_at = case when p ? 'assigned_at' then (p->>'assigned_at')::timestamptz else assigned_at end,
    started_at = case when p ? 'started_at' then (p->>'started_at')::timestamptz else started_at end,
    done_at = case when p ? 'done_at' then (p->>'done_at')::timestamptz else done_at end,
    confirmed_at = case when p ? 'confirmed_at' then (p->>'confirmed_at')::timestamptz else confirmed_at end,
    version = version + 1
  where id = _id;
  insert into public.it_events(ticket_id, type, actor, note) values (_id, _type, _actor, _note);
  perform public.write_audit(_actor, 'IT_' || _type, _id::text);
end $$;

REVOKE EXECUTE ON FUNCTION public.it_create_tx(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.it_action_tx(uuid, int, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.it_create_tx(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.it_action_tx(uuid, int, jsonb, text, text, text) TO service_role;
