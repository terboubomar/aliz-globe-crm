-- The owner and the CEO get the same full access as the super admin: every
-- brand and branch, IT tickets and the team schedule. Other roles are unchanged.
CREATE OR REPLACE FUNCTION public.staff_in_scope(_brand text, _branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select exists (select 1 from public.current_staff() s
    where s.role in ('SUPER_ADMIN', 'CEO', 'OWNER')
       or (_brand = any(s.brand_ids)
           and (cardinality(s.branch_ids) = 0 or (_branch is not null and _branch::text = any(s.branch_ids)))))
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.it_visible(_requester uuid, _assignee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select exists (select 1 from public.current_staff() s
    where s.role in ('SUPER_ADMIN', 'CEO', 'OWNER', 'IT_MANAGER')
       or _requester = s.user_id
       or (s.role = 'IT_SPECIALIST' and _assignee = s.user_id))
$$;
--> statement-breakpoint

DROP POLICY IF EXISTS "staff read brands in scope" ON public.brands;
--> statement-breakpoint
CREATE POLICY "staff read brands in scope" ON public.brands FOR SELECT TO authenticated USING (
  exists (select 1 from public.current_staff() s
    where s.role in ('SUPER_ADMIN', 'CEO', 'OWNER') or id = any(s.brand_ids)));
--> statement-breakpoint

DROP POLICY IF EXISTS "own or managed shifts" ON public.shifts;
--> statement-breakpoint
CREATE POLICY "own or managed shifts" ON public.shifts FOR SELECT TO authenticated USING (
  (user_id = auth.uid() and exists (select 1 from public.current_staff()))
  or exists (select 1 from public.current_staff() s
    where s.role in ('SUPER_ADMIN', 'CEO', 'OWNER', 'MARKETING_MANAGER', 'SHIFT_LEAD')));
