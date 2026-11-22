-- Which agent owns each WhatsApp conversation (the messages stay in Bevatel).
-- New conversations are given to an agent on shift automatically; a shift
-- lead can reassign. Read and written only by the server (service role).
CREATE TABLE IF NOT EXISTS public.whatsapp_assignments (
  conversation_id text PRIMARY KEY,
  assignee uuid NOT NULL,
  assigned_by text NOT NULL DEFAULT 'SYSTEM',
  assigned_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS whatsapp_assignments_assignee_idx
  ON public.whatsapp_assignments (assignee, assigned_at);
--> statement-breakpoint
ALTER TABLE public.whatsapp_assignments ENABLE ROW LEVEL SECURITY;
