
create extension if not exists btree_gist;

create table public.brands (
  id text primary key,
  name text not null,
  name_en text not null,
  logo text not null,
  color text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','SUSPENDED')),
  created_at timestamptz not null default now()
);
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references public.brands(id),
  name text not null,
  code text not null unique,
  city text not null,
  district text, address text, maps_url text,
  latitude double precision, longitude double precision,
  phone text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, brand_id)
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null check (role in ('SUPER_ADMIN','MARKETING_MANAGER','SHIFT_LEAD','AGENT','OPERATIONS_MANAGER','CEO','OWNER')),
  finance_duty text not null default 'NONE' check (finance_duty in ('NONE','APPROVER','PROCESSOR','VERIFIER')),
  brand_ids text[] not null default '{}',
  branch_ids text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  sequence bigint not null unique,
  brand_id text not null references public.brands(id),
  branch_id uuid,
  unknown_reason text,
  source text not null check (source in ('PUBLIC_QR','PHONE_AGENT')),
  category text not null,
  priority text not null check (priority in ('P1','P2','P3')),
  state text not null default 'NEW' check (state in ('NEW','TRIAGED','ASSIGNED','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED')),
  description_enc text not null,
  receipt_enc text,
  branch_brief_enc text,
  customer_enc text,
  phone_hash text,
  external_order text,
  platform text,
  communications_owner text not null,
  resolution_owner text,
  creator text not null,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  action_completed_at timestamptz,
  customer_confirmed_at timestamptz,
  closed_at timestamptz,
  version int not null default 1,
  sla_policy jsonb not null,
  escalated boolean not null default false,
  legal_hold boolean not null default false,
  foreign key (branch_id, brand_id) references public.branches(id, brand_id),
  unique (id, brand_id)
);
create sequence public.ticket_number_seq;
create index on public.tickets (brand_id, branch_id, state);
create index on public.tickets (phone_hash);

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  type text not null,
  actor text not null,
  note_enc text,
  created_at timestamptz not null default now()
);
create index on public.ticket_events (ticket_id, created_at);

create table public.ticket_timers (
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  milestone text not null,
  due_at timestamptz not null,
  warning_at timestamptz not null,
  breached_at timestamptz,
  completed_at timestamptz,
  primary key (ticket_id, milestone)
);

create table public.tracking_access (
  hash text primary key,
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  expires_at timestamptz not null
);

create sequence public.refund_number_seq;
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  sequence bigint not null unique default nextval('public.refund_number_seq'),
  ticket_id uuid,
  brand_id text not null references public.brands(id),
  branch_id uuid,
  external_order text not null,
  platform text not null,
  kind text not null check (kind in ('REFUND','CANCELLATION')),
  reason_enc text not null,
  amount_minor int check (amount_minor is null or amount_minor > 0),
  status text not null default 'REQUESTED',
  requester uuid not null,
  approver uuid, processor uuid, verifier uuid,
  external_reference text,
  proof_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  foreign key (ticket_id, brand_id) references public.tickets(id, brand_id) on delete restrict,
  foreign key (branch_id, brand_id) references public.branches(id, brand_id) on delete restrict,
  unique (ticket_id, kind)
);
create table public.refund_events (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refunds(id) on delete restrict,
  type text not null,
  actor text not null,
  note_enc text,
  created_at timestamptz not null default now()
);

create table public.qrs (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  hash text not null unique,
  code_enc text not null,
  placement text not null default 'استلام الطلبات',
  active boolean not null default true,
  scans int not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index qrs_one_active_per_branch on public.qrs (branch_id) where active;

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete restrict,
  refund_id uuid references public.refunds(id) on delete restrict,
  storage_key text not null unique,
  mime text not null,
  size int not null,
  checksum text not null,
  status text not null default 'PENDING_SCAN' check (status in ('PENDING_SCAN','CLEAN','INFECTED','REJECTED')),
  uploaded_by text not null,
  created_at timestamptz not null default now(),
  check (ticket_id is not null or refund_id is not null)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  break_start timestamptz, break_end timestamptz,
  lead boolean not null default false,
  day_off boolean not null default false,
  cancelled_at timestamptz,
  version int not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  check ((break_start is null) = (break_end is null)),
  check (break_start is null or (break_start >= start_at and break_end <= end_at and break_end > break_start)),
  exclude using gist (user_id with =, tstzrange(start_at, end_at) with &&) where (cancelled_at is null)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_id text not null,
  created_at timestamptz not null default now()
);
create table public.idempotency (
  key text primary key,
  request_hash text not null,
  response_enc text not null,
  expires_at timestamptz not null
);
create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  type text not null,
  ticket_id uuid not null,
  status text not null default 'HELD_PROVIDER_NOT_CONFIGURED',
  created_at timestamptz not null default now()
);

create or replace function public.forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'APPEND_ONLY: % rows cannot be changed or deleted', TG_TABLE_NAME; end $$;
create trigger ticket_events_append_only before update or delete on public.ticket_events for each row execute function public.forbid_mutation();
create trigger refund_events_append_only before update or delete on public.refund_events for each row execute function public.forbid_mutation();
create trigger audit_log_append_only before update or delete on public.audit_log for each row execute function public.forbid_mutation();
create trigger tickets_no_delete before delete on public.tickets for each row execute function public.forbid_mutation();
create trigger refunds_no_delete before delete on public.refunds for each row execute function public.forbid_mutation();

grant select on public.brands, public.branches, public.tickets, public.ticket_events, public.ticket_timers,
  public.refunds, public.refund_events, public.shifts, public.user_roles, public.app_settings, public.attachments to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter table public.brands enable row level security;
alter table public.branches enable row level security;
alter table public.user_roles enable row level security;
alter table public.app_settings enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_events enable row level security;
alter table public.ticket_timers enable row level security;
alter table public.tracking_access enable row level security;
alter table public.refunds enable row level security;
alter table public.refund_events enable row level security;
alter table public.qrs enable row level security;
alter table public.attachments enable row level security;
alter table public.shifts enable row level security;
alter table public.audit_log enable row level security;
alter table public.idempotency enable row level security;
alter table public.outbox enable row level security;

create or replace function public.current_staff()
returns setof public.user_roles language sql stable security definer set search_path = public as $$
  select r.* from public.user_roles r
  where r.user_id = auth.uid() and r.enabled
    and (coalesce((select (value)::text from public.app_settings where key='require_mfa'),'true') <> 'true'
         or coalesce(auth.jwt()->>'aal','') = 'aal2')
$$;
create or replace function public.staff_in_scope(_brand text, _branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.current_staff() s
    where _brand = any(s.brand_ids)
      and (cardinality(s.branch_ids) = 0 or (_branch is not null and _branch::text = any(s.branch_ids))))
$$;
create or replace function public.ticket_visible(_brand text, _branch uuid, _escalated boolean, _owner text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.staff_in_scope(_brand, _branch) and exists (select 1 from public.current_staff() s
    where s.role <> 'OPERATIONS_MANAGER' or (_escalated and _owner = s.user_id::text))
$$;
create or replace function public.refund_visible(_brand text, _branch uuid, _requester uuid, _ticket uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.staff_in_scope(_brand, _branch) and exists (select 1 from public.current_staff() s
    where (s.role <> 'AGENT' or s.finance_duty <> 'NONE' or _requester = s.user_id)
      and (s.role <> 'OPERATIONS_MANAGER' or exists (select 1 from public.tickets t
           where t.id = _ticket and t.escalated and t.resolution_owner = s.user_id::text)))
$$;
revoke execute on function public.current_staff(), public.staff_in_scope(text,uuid), public.ticket_visible(text,uuid,boolean,text), public.refund_visible(text,uuid,uuid,uuid) from public, anon;
grant execute on function public.current_staff(), public.staff_in_scope(text,uuid), public.ticket_visible(text,uuid,boolean,text), public.refund_visible(text,uuid,uuid,uuid) to authenticated, service_role;

create policy "staff read own access row" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "staff read brands in scope" on public.brands for select to authenticated using (exists (select 1 from public.current_staff() s where id = any(s.brand_ids)));
create policy "staff read branches in scope" on public.branches for select to authenticated using (public.staff_in_scope(brand_id, id));
create policy "staff read settings" on public.app_settings for select to authenticated using (exists (select 1 from public.current_staff()));
create policy "scoped ticket read" on public.tickets for select to authenticated using (public.ticket_visible(brand_id, branch_id, escalated, resolution_owner));
create policy "scoped event read" on public.ticket_events for select to authenticated using (exists (select 1 from public.tickets t where t.id = ticket_id));
create policy "scoped timer read" on public.ticket_timers for select to authenticated using (exists (select 1 from public.tickets t where t.id = ticket_id));
create policy "scoped refund read" on public.refunds for select to authenticated using (public.refund_visible(brand_id, branch_id, requester, ticket_id));
create policy "scoped refund event read" on public.refund_events for select to authenticated using (exists (select 1 from public.refunds r where r.id = refund_id));
create policy "scoped attachment read" on public.attachments for select to authenticated using (
  (ticket_id is not null and exists (select 1 from public.tickets t where t.id = ticket_id))
  or (refund_id is not null and exists (select 1 from public.refunds r where r.id = refund_id)));
create policy "own or managed shifts" on public.shifts for select to authenticated using (
  (user_id = auth.uid() and exists (select 1 from public.current_staff()))
  or exists (select 1 from public.current_staff() s where s.role in ('SUPER_ADMIN','MARKETING_MANAGER','SHIFT_LEAD')));

create or replace function public.write_audit(_actor text, _action text, _entity text) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log(actor, action, entity_id) values (_actor, _action, _entity) $$;

create or replace function public.next_ticket_sequence() returns bigint language sql security definer set search_path = public as $$ select nextval('public.ticket_number_seq') $$;

create or replace function public.create_ticket_tx(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare existing public.idempotency; tid uuid; b public.brands; br_ok boolean;
begin
  select * into existing from public.idempotency where key = p->>'idem_key' and expires_at > now();
  if found then
    if existing.request_hash <> p->>'request_hash' then raise exception 'KEY_REUSED'; end if;
    return jsonb_build_object('replay', true, 'response_enc', existing.response_enc);
  end if;
  perform pg_advisory_xact_lock(hashtext(p->>'brand_id'));
  select * into b from public.brands where id = p->>'brand_id';
  if not found or b.status <> 'ACTIVE' then raise exception 'BRAND_INACTIVE'; end if;
  if p->>'branch_id' is not null then
    perform pg_advisory_xact_lock(hashtext(p->>'branch_id'));
    select exists(select 1 from public.branches where id = (p->>'branch_id')::uuid and brand_id = b.id and active) into br_ok;
    if not br_ok then raise exception 'INVALID_BRANCH'; end if;
  end if;
  insert into public.tickets(sequence, brand_id, branch_id, unknown_reason, source, category, priority, description_enc,
    receipt_enc, customer_enc, phone_hash, external_order, platform, communications_owner, creator, received_at, sla_policy)
  values ((p->>'sequence')::bigint, b.id, (p->>'branch_id')::uuid, p->>'unknown_reason', p->>'source', p->>'category', p->>'priority',
    p->>'description_enc', p->>'receipt_enc', p->>'customer_enc', p->>'phone_hash', p->>'external_order', p->>'platform',
    p->>'communications_owner', p->>'creator', (p->>'received_at')::timestamptz, p->'sla_policy')
  returning id into tid;
  insert into public.ticket_events(ticket_id, type, actor) values (tid, p->>'event_type', p->>'actor');
  insert into public.audit_log(actor, action, entity_id) values (p->>'actor', p->>'event_type', tid::text);
  insert into public.ticket_timers(ticket_id, milestone, due_at, warning_at)
    select tid, m->>'milestone', (m->>'due_at')::timestamptz, (m->>'warning_at')::timestamptz from jsonb_array_elements(p->'timers') m;
  insert into public.outbox(key, type, ticket_id) values ('created:'||tid, case when p->>'priority'='P1' then 'SAFETY_INTAKE' else 'NEW_TICKET' end, tid);
  if p->>'access_hash' is not null then
    insert into public.tracking_access(hash, ticket_id, expires_at) values (p->>'access_hash', tid, now() + interval '30 days');
  end if;
  insert into public.idempotency(key, request_hash, response_enc, expires_at)
    values (p->>'idem_key', p->>'request_hash', p->>'response_enc', now() + interval '1 day');
  return jsonb_build_object('replay', false, 'id', tid);
end $$;

create or replace function public.apply_ticket_action(_id uuid, _version int, p jsonb, _events jsonb, _timers jsonb, _actor text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tickets; e jsonb; m jsonb;
begin
  select * into t from public.tickets where id = _id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if t.version <> _version then raise exception 'CONFLICT'; end if;
  if (p->>'state') = 'CLOSED' and exists (select 1 from public.refunds r where r.ticket_id = _id and r.status not in ('COMPLETED','REJECTED')) then
    raise exception 'CLOSURE_BLOCKED'; end if;
  update public.tickets set
    state = coalesce(p->>'state', state),
    version = version + 1,
    resolution_owner = case when p ? 'resolution_owner' then p->>'resolution_owner' else resolution_owner end,
    communications_owner = coalesce(p->>'communications_owner', communications_owner),
    escalated = coalesce((p->>'escalated')::boolean, escalated),
    branch_brief_enc = coalesce(p->>'branch_brief_enc', branch_brief_enc),
    acknowledged_at = case when p ? 'acknowledged_at' then (p->>'acknowledged_at')::timestamptz else acknowledged_at end,
    action_completed_at = case when p ? 'action_completed_at' then (p->>'action_completed_at')::timestamptz else action_completed_at end,
    customer_confirmed_at = case when p ? 'customer_confirmed_at' then (p->>'customer_confirmed_at')::timestamptz else customer_confirmed_at end,
    closed_at = case when p ? 'closed_at' then (p->>'closed_at')::timestamptz else closed_at end
  where id = _id;
  for e in select * from jsonb_array_elements(_events) loop
    insert into public.ticket_events(ticket_id, type, actor, note_enc) values (_id, e->>'type', _actor, e->>'note_enc');
    insert into public.audit_log(actor, action, entity_id) values (_actor, e->>'type', _id::text);
  end loop;
  for m in select * from jsonb_array_elements(_timers) loop
    if m->>'op' = 'complete' then
      update public.ticket_timers set completed_at = now() where ticket_id = _id and milestone = m->>'milestone' and completed_at is null;
    elsif m->>'op' = 'reopen' then
      update public.ticket_timers set completed_at = null where ticket_id = _id and milestone = m->>'milestone';
    elsif m->>'op' = 'upsert' then
      insert into public.ticket_timers(ticket_id, milestone, due_at, warning_at) values (_id, m->>'milestone', (m->>'due_at')::timestamptz, (m->>'warning_at')::timestamptz)
      on conflict (ticket_id, milestone) do update set due_at = excluded.due_at, warning_at = excluded.warning_at, completed_at = null, breached_at = null;
    end if;
  end loop;
end $$;

create or replace function public.request_refund_tx(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if p->>'branch_id' is not null then
    perform pg_advisory_xact_lock(hashtext(p->>'branch_id'));
    if not exists (select 1 from public.branches where id = (p->>'branch_id')::uuid and brand_id = p->>'brand_id' and active) then raise exception 'INVALID_BRANCH'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext((p->>'brand_id')||':'||(p->>'platform')||':'||(p->>'external_order')));
  if exists (select 1 from public.refunds where brand_id = p->>'brand_id' and platform = p->>'platform' and external_order = p->>'external_order' and status not in ('REJECTED','COMPLETED')) then
    raise exception 'DUPLICATE_REFUND'; end if;
  insert into public.refunds(ticket_id, brand_id, branch_id, external_order, platform, kind, reason_enc, amount_minor, requester)
  values ((p->>'ticket_id')::uuid, p->>'brand_id', (p->>'branch_id')::uuid, p->>'external_order', p->>'platform', p->>'kind', p->>'reason_enc', (p->>'amount_minor')::int, (p->>'requester')::uuid)
  returning id into rid;
  insert into public.refund_events(refund_id, type, actor) values (rid, 'REFUND_REQUESTED', p->>'requester');
  insert into public.audit_log(actor, action, entity_id) values (p->>'requester', 'REFUND_REQUESTED', rid::text);
  return rid;
end $$;

create or replace function public.apply_refund_action(_id uuid, _version int, p jsonb, _type text, _note_enc text, _actor text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.refunds;
begin
  select * into r from public.refunds where id = _id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.version <> _version then raise exception 'CONFLICT'; end if;
  if _type = 'RESUBMIT' then
    perform pg_advisory_xact_lock(hashtext(r.brand_id||':'||r.platform||':'||r.external_order));
    if exists (select 1 from public.refunds where id <> r.id and brand_id = r.brand_id and platform = r.platform and external_order = r.external_order and status not in ('REJECTED','COMPLETED')) then
      raise exception 'DUPLICATE_REFUND'; end if;
  end if;
  update public.refunds set
    status = p->>'status', version = version + 1, updated_at = now(),
    approver = case when p ? 'approver' then (p->>'approver')::uuid else approver end,
    processor = case when p ? 'processor' then (p->>'processor')::uuid else processor end,
    verifier = case when p ? 'verifier' then (p->>'verifier')::uuid else verifier end,
    external_reference = case when p ? 'external_reference' then p->>'external_reference' else external_reference end,
    proof_id = case when p ? 'proof_id' then (p->>'proof_id')::uuid else proof_id end,
    reason_enc = coalesce(p->>'reason_enc', reason_enc),
    amount_minor = case when p ? 'amount_minor' then (p->>'amount_minor')::int else amount_minor end
  where id = _id;
  insert into public.refund_events(refund_id, type, actor, note_enc) values (_id, _type, _actor, _note_enc);
  insert into public.audit_log(actor, action, entity_id) values (_actor, _type, _id::text);
end $$;

create or replace function public.qr_ensure(_branch uuid, _hash text, _code_enc text, _actor text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.qrs;
begin
  perform pg_advisory_xact_lock(hashtext(_branch::text));
  if not exists (select 1 from public.branches where id = _branch and active) then raise exception 'BRANCH_INACTIVE'; end if;
  select * into q from public.qrs where branch_id = _branch and active;
  if found then return jsonb_build_object('id', q.id, 'code_enc', q.code_enc, 'created', false); end if;
  insert into public.qrs(branch_id, hash, code_enc) values (_branch, _hash, _code_enc) returning * into q;
  insert into public.audit_log(actor, action, entity_id) values (_actor, 'QR_CREATED', q.id::text);
  return jsonb_build_object('id', q.id, 'code_enc', q.code_enc, 'created', true);
end $$;

create or replace function public.qr_retire(_id uuid, _actor text, _new_hash text, _new_code_enc text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.qrs; n public.qrs;
begin
  select * into q from public.qrs where id = _id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext(q.branch_id::text));
  if not q.active then raise exception 'QR_RETIRED'; end if;
  update public.qrs set active = false, revoked_at = now() where id = _id;
  insert into public.audit_log(actor, action, entity_id) values (_actor, 'QR_REVOKED', _id::text);
  if _new_hash is null then return jsonb_build_object('ok', true); end if;
  if not exists (select 1 from public.branches where id = q.branch_id and active) then raise exception 'BRANCH_INACTIVE'; end if;
  insert into public.qrs(branch_id, hash, code_enc) values (q.branch_id, _new_hash, _new_code_enc) returning * into n;
  insert into public.audit_log(actor, action, entity_id) values (_actor, 'QR_CREATED', n.id::text);
  return jsonb_build_object('id', n.id, 'code_enc', n.code_enc);
end $$;

create or replace function public.save_shifts_tx(_entries jsonb, _actor uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  for e in select value from jsonb_array_elements(_entries) order by (value->>'user_id') loop
    perform pg_advisory_xact_lock(hashtext('staff:'||(e->>'user_id')));
    insert into public.shifts(user_id, start_at, end_at, break_start, break_end, lead, day_off, created_by)
    values ((e->>'user_id')::uuid, (e->>'start_at')::timestamptz, (e->>'end_at')::timestamptz,
      (e->>'break_start')::timestamptz, (e->>'break_end')::timestamptz, coalesce((e->>'lead')::boolean,false), coalesce((e->>'day_off')::boolean,false), _actor);
    n := n + 1;
  end loop;
  insert into public.audit_log(actor, action, entity_id) values (_actor::text, 'SHIFTS_SAVED', n::text);
  return n;
end $$;

do $$ declare f text; begin
  for f in select unnest(array['write_audit(text,text,text)','next_ticket_sequence()','create_ticket_tx(jsonb)','apply_ticket_action(uuid,int,jsonb,jsonb,jsonb,text)',
    'request_refund_tx(jsonb)','apply_refund_action(uuid,int,jsonb,text,text,text)','qr_ensure(uuid,text,text,text)','qr_retire(uuid,text,text,text)','save_shifts_tx(jsonb,uuid)','forbid_mutation()']) loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

insert into public.brands(id, name, name_en, logo, color, status) values
 ('waqf','واقف','Burger Waqf','waqf','#B62E30','DRAFT'),
 ('kabab','كباب علوم','Kabab Uloom','kabab','#15A84C','DRAFT'),
 ('batatisyon','بطاطسيون','Batatisyon','batatisyon','#E95627','DRAFT'),
 ('mazmuzil','مزمزيل','Mazmuzil','mazmuzil','#827B41','DRAFT'),
 ('shawarman','شاورمان','Shawarman','shawarman','#C52C31','DRAFT');

insert into public.app_settings(key, value) values
 ('require_mfa', 'true'),
 ('public_intake_enabled', 'false'),
 ('finance_policy_approved', 'false'),
 ('finance_approval_limit_minor', 'null'),
 ('sla_policy', '{"version":"PROPOSED-DEMO-V1","approved":false,"p1First":5,"p1Ack":5,"p2First":5,"p2Ack":5,"p2Remedy":30,"p3First":15,"p3Ack":30,"p3Remedy":240}'),
 ('whatsapp_enabled', 'false'),
 ('telegram_enabled', 'false');
