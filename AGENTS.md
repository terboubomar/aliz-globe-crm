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
- Business rules live in `src/lib/domain.ts` (ported from source `packages/domain`); UI and server both import it — keep it pure.
- Server logic lives in `src/functions/` (`*.functions.ts` = createServerFn, `*.server.ts` = helpers loaded via dynamic import). Folders named `server/` are blocked from the client graph.
- Browsers only SELECT through RLS (role + brand/branch scope + MFA in `current_staff()`); every write goes through a server function that authorizes with domain rules, then calls a service-role-only SQL procedure so state change + event + audit are atomic.
- Event and audit tables are append-only via triggers; never add UPDATE/DELETE paths.
- Roles live only in `public.user_roles`; never read privileges from auth metadata.
