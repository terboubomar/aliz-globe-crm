<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture (Aliz Globe CRM migration)
- **Screens and design come from the original app, unchanged.** `src/aliz/` holds the original staff workspace, QR form and tracking page, styled by `src/aliz/style.css` with Cairo bundled from `@fontsource/cairo` and the original logos in `public/logos/`. `/` is the staff workspace (views switch with `?view=`), `/q/$code` the public form and `/track/$token` the customer tracking page. Do not restyle these screens with Tailwind or shadcn; Tailwind's reset is off and it does not scan `src/aliz/`, so the original stylesheet renders exactly as designed.
- `src/aliz/adapter.ts` is the only place the screens reach the backend: it turns their original REST-style calls into the server functions below (and RLS-scoped reads), and returns the original data shapes. Features without a backend yet (follow-up tasks, QA reviews, leave requests, audit view, Telegram/WhatsApp, brand create/delete, branch delete) show a clear "not available yet" message. `src/test/aliz-adapter.test.ts` covers the mapping.
- Photos: the browser redraws each image before upload (`src/aliz/prepare-image.ts`: applies rotation, max 1800px, JPEG). The server then rebuilds every photo from its pixels (`src/lib/image-rebuild.ts`, pure-JS jpeg-js): only the re-encoded JPEG is stored, so no metadata (EXIF/GPS) or hidden content survives. This replaces a malware scanner for photos (owner decision, 2026-10-28); only images are accepted, no PDFs. Rebuilt files are stored `CLEAN` in the private `evidence` bucket (`src/functions/evidence.server.ts`, created on first use); older `PENDING_SCAN` photos are rebuilt the first time staff open them, and anything that cannot be rebuilt is never served. QR-form photos (`publicAttach`) are authorized only by the new complaint's tracking link, within 10 minutes, max 3 × 5 MB.
- Sign-in keeps this backend's protection: after the password, `src/aliz/access-gate.tsx` (styled like the sign-in page) enrols or verifies two-factor before any data loads, and offers the one-time first-administrator claim.
- Business rules live in `src/lib/domain.ts` (ported from source `packages/domain`); UI and server both import it — keep it pure.
- Server logic lives in `src/functions/` (`*.functions.ts` = createServerFn, `*.server.ts` = helpers loaded via dynamic import). Folders named `server/` are blocked from the client graph.
- Browsers only SELECT through RLS (role + brand/branch scope + MFA in `current_staff()`); every write goes through a server function that authorizes with domain rules, then calls a service-role-only SQL procedure so state change + event + audit are atomic.
- Event and audit tables are append-only via triggers; never add UPDATE/DELETE paths.
- Roles live only in `public.user_roles`; never read privileges from auth metadata.

## Customer receipts

WhatsApp and email confirmations to the customer live in
`src/functions/receipts.server.ts`; setup and rules are in
`docs/CUSTOMER_RECEIPTS.md`. Delivery state uses the existing `outbox` table
(no schema change). Both channels stay off until a super admin switches them on
in Settings, which is refused while any required secret is missing.
