-- Meta inbox: Instagram and Facebook Messenger direct messages in the CRM.
-- Connected pages (tokens encrypted), conversations and their messages.
-- Read and written by the server only; a chat can become a complaint.
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_source_check
  CHECK (source = ANY (ARRAY['PUBLIC_QR'::text, 'PHONE_AGENT'::text, 'GOOGLE_REVIEW'::text, 'SOCIAL_DM'::text]));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.meta_pages (
  page_id text PRIMARY KEY,
  name text NOT NULL,
  ig_id text UNIQUE,
  ig_username text,
  brand_id text REFERENCES public.brands(id),
  token_enc text NOT NULL,
  subscribed boolean NOT NULL DEFAULT false,
  connected_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.meta_threads (
  id text PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('FB', 'IG')),
  page_id text NOT NULL REFERENCES public.meta_pages(page_id) ON DELETE CASCADE,
  brand_id text REFERENCES public.brands(id),
  customer_id text NOT NULL,
  customer_name_enc text,
  last_text_enc text,
  last_message_at timestamptz NOT NULL,
  last_customer_at timestamptz,
  unread integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  taken_by text,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_threads_recent ON public.meta_threads (status, last_message_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.meta_messages (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES public.meta_threads(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  text_enc text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_by text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS meta_messages_thread ON public.meta_messages (thread_id, created_at);
--> statement-breakpoint
ALTER TABLE public.meta_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_pages, public.meta_threads, public.meta_messages FROM anon, authenticated;
