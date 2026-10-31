# Security review — 31 October 2026

Scope: the live CRM (staff console, public QR form, tracking page, webhooks),
its Supabase database and storage, and the app's dependencies.

## Findings and what was done

| # | Area | Finding | Status |
|---|------|---------|--------|
| 1 | Dependencies | Production dependencies: **0 known vulnerabilities**. 19 *moderate* advisories, all in developer tooling (ESLint, drizzle-kit/esbuild dev server); not shipped to users. | OK — track via Dependabot |
| 2 | Database access | RLS is on for all 16 tables; only read policies exist; all writes go through the server (service role) and transactional RPCs; event/audit tables are append-only; tickets and refunds cannot be deleted. | OK |
| 3 | Database grants | Supabase's default grants still gave `anon` full table rights and `authenticated` write/TRUNCATE rights (blocked by RLS today, but TRUNCATE is not covered by RLS). | **Fixed** — revoked (migration `0002_harden_grants`, applied live) |
| 4 | Storage | `evidence` bucket is private with an 8 MB limit, but accepted any file type. | **Fixed** — JPEG/PNG/WebP/PDF only |
| 5 | Security functions | All `SECURITY DEFINER` functions pin `search_path`; only the read helpers are callable by signed-in staff; none by visitors. | OK |
| 6 | Public QR form | No flood protection: a script could submit thousands of complaints (each alerts staff on Telegram). | **Fixed** — 5 per device / 15 min and 40 per QR / hour |
| 7 | Tracking links | Long random tokens, stored only as keyed hashes, expire; page shows no staff or other cases. | OK |
| 8 | Webhooks & cron | Telegram webhook and cron endpoints require secrets compared in constant time; WhatsApp checks the signature. | OK |
| 9 | Browser headers | No security headers: the staff console could be framed by another site (clickjacking). | **Fixed** — HSTS, nosniff, Referrer-Policy, Permissions-Policy, CSP `frame-ancestors` (only the app and the Lovable editor) |
| 10 | Customer data | Name/phone/email encrypted at rest; phone search uses a keyed hash and is limited to roles with customer-data rights; Telegram messages carry no customer data. | OK |
| 11 | Sign-in | Two-step verification available (optional; can be required for all in Settings). | OK |

## Recommended next (needs the owner)

1. **Supabase Auth settings** (Lovable Cloud → Users → Auth settings): turn on
   *leaked password protection*, minimum password length 10+, and keep email
   confirmation on.
2. **Require two-step verification for admins**: at least the Super Admin and
   Shift Lead accounts should switch it on from the account menu.
3. **Review staff accounts monthly**: disable leavers (Settings → Users).
4. **Rotate secrets** if anyone who had them leaves (Telegram bot token, cron
   secret, encryption key — rotate the encryption key only with a re-encryption
   plan).
5. **Merge the open Dependabot updates** after CI is green.
