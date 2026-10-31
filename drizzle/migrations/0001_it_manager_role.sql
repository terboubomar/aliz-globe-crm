-- IT manager: a refunds-only role.
-- 1) Allow the new role value.
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'user_roles' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%SUPER_ADMIN%'
  loop
    execute format('alter table public.user_roles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('SUPER_ADMIN','MARKETING_MANAGER','SHIFT_LEAD','AGENT','OPERATIONS_MANAGER','CEO','OWNER','IT_MANAGER'));

-- 2) Complaints are never visible to an IT manager (refunds stay visible in their brand/branch scope).
create or replace function public.ticket_visible(_brand text, _branch uuid, _escalated boolean, _owner text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.staff_in_scope(_brand, _branch) and exists (select 1 from public.current_staff() s
    where s.role <> 'IT_MANAGER'
      and (s.role <> 'OPERATIONS_MANAGER' or (_escalated and _owner = s.user_id::text)))
$$;
