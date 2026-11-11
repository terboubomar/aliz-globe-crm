-- Google Business Profile reviews are back (the owner asked for them again).
-- Same schema as 0003, which 0005 had dropped.
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_source_check
  CHECK (source = ANY (ARRAY['PUBLIC_QR'::text, 'PHONE_AGENT'::text, 'GOOGLE_REVIEW'::text]));
--> statement-breakpoint
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS google_location text UNIQUE;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.google_reviews (
  id text PRIMARY KEY,
  location text NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  brand_id text REFERENCES public.brands(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  reviewer_enc text,
  comment_enc text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  reply_enc text,
  reply_state text NOT NULL DEFAULT 'NONE' CHECK (reply_state IN ('NONE', 'DRAFT', 'SENT', 'FAILED', 'HISTORY')),
  reply_source text CHECK (reply_source IN ('SCRIPT', 'AI', 'STAFF', 'GOOGLE')),
  replied_at timestamptz,
  replied_by text,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS google_reviews_branch_created ON public.google_reviews (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS google_reviews_state ON public.google_reviews (reply_state);
CREATE INDEX IF NOT EXISTS google_reviews_ticket ON public.google_reviews (ticket_id);
--> statement-breakpoint
ALTER TABLE public.google_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_reviews FROM anon, authenticated;
