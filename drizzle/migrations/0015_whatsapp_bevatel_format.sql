-- Bevatel's own layout (template components + full processed_params) becomes the
-- default: it is the only one Bevatel hands to WhatsApp.
ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_format_check;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_format_check
  CHECK (format IN ('bevatel', 'flat', 'body', 'text'));
ALTER TABLE public.whatsapp_messages ALTER COLUMN format SET DEFAULT 'bevatel';
