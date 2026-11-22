-- WhatsApp chats can become complaints: a new complaint source, and per chat
-- the AI suggestion (is it a complaint, which brand, branch and reason) and the
-- complaint registered from it. Messages stay in Bevatel. Server-only table.
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
--> statement-breakpoint
ALTER TABLE public.tickets ADD CONSTRAINT tickets_source_check
  CHECK (source = ANY (ARRAY['PUBLIC_QR'::text, 'PHONE_AGENT'::text, 'GOOGLE_REVIEW'::text, 'WHATSAPP'::text]));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.whatsapp_complaints (
  conversation_id text PRIMARY KEY,
  suggestion jsonb,
  analyzed_message_id text,
  analyzed_at timestamptz,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  registered_by uuid,
  registered_at timestamptz
);
--> statement-breakpoint
ALTER TABLE public.whatsapp_complaints ENABLE ROW LEVEL SECURITY;
