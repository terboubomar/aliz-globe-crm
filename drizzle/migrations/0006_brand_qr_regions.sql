-- One QR code per brand, and branches grouped by region.
-- A brand QR opens the complaint form for the brand; the customer then picks
-- the region, the city and the branch. Existing branch QR codes keep working.
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS region text
  CHECK (region IS NULL OR region IN ('RIYADH', 'MAKKAH', 'MADINAH', 'QASSIM', 'EASTERN', 'ASIR', 'TABUK',
    'HAIL', 'NORTHERN', 'JAZAN', 'NAJRAN', 'BAHA', 'JOUF'));
--> statement-breakpoint
ALTER TABLE public.qrs ADD COLUMN IF NOT EXISTS brand_id text REFERENCES public.brands(id);
ALTER TABLE public.qrs ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE public.qrs DROP CONSTRAINT IF EXISTS qrs_one_target;
ALTER TABLE public.qrs ADD CONSTRAINT qrs_one_target CHECK (num_nonnulls(branch_id, brand_id) = 1);
CREATE UNIQUE INDEX IF NOT EXISTS qrs_one_active_per_brand ON public.qrs (brand_id) WHERE active AND brand_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.qr_ensure_brand(_brand text, _hash text, _code_enc text, _actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare q public.qrs;
begin
  perform pg_advisory_xact_lock(hashtext('brand:' || _brand));
  if not exists (select 1 from public.brands where id = _brand and status = 'ACTIVE') then raise exception 'BRAND_INACTIVE'; end if;
  select * into q from public.qrs where brand_id = _brand and active;
  if found then return jsonb_build_object('id', q.id, 'code_enc', q.code_enc, 'created', false); end if;
  insert into public.qrs(brand_id, hash, code_enc) values (_brand, _hash, _code_enc) returning * into q;
  insert into public.audit_log(actor, action, entity_id) values (_actor, 'QR_CREATED', q.id::text);
  return jsonb_build_object('id', q.id, 'code_enc', q.code_enc, 'created', true);
end $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.qr_retire(_id uuid, _actor text, _new_hash text, _new_code_enc text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare q public.qrs; n public.qrs;
begin
  select * into q from public.qrs where id = _id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext(coalesce(q.branch_id::text, 'brand:' || q.brand_id)));
  if not q.active then raise exception 'QR_RETIRED'; end if;
  update public.qrs set active = false, revoked_at = now() where id = _id;
  insert into public.audit_log(actor, action, entity_id) values (_actor, 'QR_REVOKED', _id::text);
  if _new_hash is null then return jsonb_build_object('ok', true); end if;
  if q.branch_id is not null and not exists (select 1 from public.branches where id = q.branch_id and active) then
    raise exception 'BRANCH_INACTIVE'; end if;
  if q.brand_id is not null and not exists (select 1 from public.brands where id = q.brand_id and status = 'ACTIVE') then
    raise exception 'BRAND_INACTIVE'; end if;
  insert into public.qrs(branch_id, brand_id, hash, code_enc) values (q.branch_id, q.brand_id, _new_hash, _new_code_enc) returning * into n;
  insert into public.audit_log(actor, action, entity_id) values (_actor, 'QR_CREATED', n.id::text);
  return jsonb_build_object('id', n.id, 'code_enc', n.code_enc);
end $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.qr_ensure_brand(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_ensure_brand(text, text, text, text) TO service_role;
--> statement-breakpoint
UPDATE public.branches SET region = 'EASTERN' WHERE region IS NULL AND city IN ('سيهات', 'الخبر', 'الدمام', 'القطيف', 'الظهران', 'الجبيل', 'الأحساء', 'الهفوف', 'رأس تنورة', 'صفوى');
