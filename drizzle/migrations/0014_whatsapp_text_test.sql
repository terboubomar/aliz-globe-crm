-- Tests may also send a plain message without the template ("text").
ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_format_check;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_format_check
  CHECK (format IN ('flat', 'body', 'text'));
