-- WhatsApp through Bevatel (Chatwoot API): one row per send attempt, test sends
-- included. Phone numbers are stored masked; template values and Bevatel's
-- reply are encrypted (they can contain the complaint text). No direct access:
-- the server reads and writes it.
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid REFERENCES public.tickets(id) ON DELETE RESTRICT,
  template text NOT NULL CHECK (template IN ('received', 'resolved', 'closed')),
  is_test boolean NOT NULL DEFAULT false,
  manual boolean NOT NULL DEFAULT false,
  phone_masked text,
  params_enc text,
  bevatel_contact_id text,
  bevatel_conversation_id text,
  bevatel_message_id text,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error text,
  response_enc text,
  confirmed_at timestamptz,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_complaint ON public.whatsapp_messages (complaint_id, created_at);
-- The same template is sent automatically at most once per complaint.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_once
  ON public.whatsapp_messages (complaint_id, template)
  WHERE status = 'sent' AND NOT manual AND NOT is_test;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_messages FROM anon, authenticated;
--> statement-breakpoint
-- Automatic sending stays off until a test message has reached a phone.
UPDATE public.app_settings SET value = 'false'::jsonb, updated_at = now() WHERE key = 'whatsapp_enabled';
