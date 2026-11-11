-- Bevatel versions differ in how template values are sent: "flat" ({"1": …}) or
-- "body" ({"body": {"1": …}}). Each attempt records the layout it used; the one
-- of a confirmed test becomes the layout for automatic sends.
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'flat'
  CHECK (format IN ('flat', 'body'));
