-- QR stats: one row per visit to a QR form (time and code only, nothing about
-- the visitor), so scans can be counted per day next to the complaints and
-- suggestions sent from the form.
CREATE TABLE IF NOT EXISTS public.qr_scans (
  id bigserial PRIMARY KEY,
  qr_id uuid NOT NULL REFERENCES public.qrs(id) ON DELETE CASCADE,
  brand_id text NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qr_scans_brand_time ON public.qr_scans (brand_id, scanned_at);
ALTER TABLE public.qr_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qr_scans FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.qr_scans_id_seq FROM anon, authenticated;
--> statement-breakpoint
-- Daily figures (Riyadh days) for the given brands. Service role only; the
-- server checks the person's brands before calling it.
CREATE OR REPLACE FUNCTION public.qr_stats(_from timestamptz, _to timestamptz, _brands text[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select jsonb_build_object(
    'scans', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'brandId', brand_id, 'n', n))
      from (select (scanned_at at time zone 'Asia/Riyadh')::date d, brand_id, count(*) n
            from public.qr_scans where scanned_at >= _from and scanned_at < _to and brand_id = any(_brands)
            group by 1, 2) s), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'brandId', brand_id, 'branchId', branch_id, 'suggestion', sug, 'n', n))
      from (select (created_at at time zone 'Asia/Riyadh')::date d, brand_id, branch_id, category = 'SUGGESTION' sug, count(*) n
            from public.tickets where source = 'PUBLIC_QR' and created_at >= _from and created_at < _to and brand_id = any(_brands)
            group by 1, 2, 3, 4) t), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'n', n))
      from (select extract(hour from scanned_at at time zone 'Asia/Riyadh')::int h, count(*) n
            from public.qr_scans where scanned_at >= _from and scanned_at < _to and brand_id = any(_brands)
            group by 1) x), '[]'::jsonb)
  )
$$;
REVOKE EXECUTE ON FUNCTION public.qr_stats(timestamptz, timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_stats(timestamptz, timestamptz, text[]) TO service_role;
