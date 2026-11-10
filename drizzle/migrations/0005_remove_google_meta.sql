-- Google Business Profile reviews and the Meta (Instagram/Messenger) inbox
-- were removed from the CRM. Their tables held no data; complaints can again
-- come only from the QR form or a phone call.
DROP TABLE IF EXISTS public.meta_messages;
DROP TABLE IF EXISTS public.meta_threads;
DROP TABLE IF EXISTS public.meta_pages;
DROP TABLE IF EXISTS public.google_reviews;
--> statement-breakpoint
ALTER TABLE public.branches DROP COLUMN IF EXISTS google_location;
--> statement-breakpoint
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_source_check
  CHECK (source = ANY (ARRAY['PUBLIC_QR'::text, 'PHONE_AGENT'::text]));
--> statement-breakpoint
DELETE FROM public.app_settings WHERE key = 'google_reviews';
DELETE FROM public.outbox
  WHERE key LIKE 'google:%' OR key LIKE 'ggstate:%' OR key LIKE 'meta:%' OR key LIKE 'mtstate:%';
