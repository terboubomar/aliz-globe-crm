-- Customer satisfaction: a 1-5 score (and optional comment) per complaint,
-- given on the tracking page once the complaint is solved. Staff read the
-- scores of the complaints they can see; writes go through the server.
CREATE TABLE IF NOT EXISTS public.complaint_ratings (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment_enc text,
  source text NOT NULL DEFAULT 'TRACKING' CHECK (source IN ('TRACKING', 'AGENT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.complaint_ratings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "scoped rating read" ON public.complaint_ratings;
--> statement-breakpoint
CREATE POLICY "scoped rating read" ON public.complaint_ratings FOR SELECT TO authenticated
  USING (exists (select 1 from public.tickets t where t.id = ticket_id));
