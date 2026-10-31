-- Security hardening (defence in depth). Row-level security already limits
-- what staff can read and every write goes through the server's service role;
-- these grants remove what no one should have in the first place.

-- Visitors (not signed in) never read or write tables directly.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
--> statement-breakpoint
-- Signed-in staff only read through RLS; writes go through server functions.
-- (TRUNCATE is not covered by RLS, so it must not be granted.)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
--> statement-breakpoint
-- Same for tables created later by the migration role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
--> statement-breakpoint
-- Evidence storage accepts only the file types the app uploads.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'evidence';
