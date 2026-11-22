# Apps in the CRM

The CRM holds three apps. After signing in, people see the apps their role opens;
someone with more than one main app picks where to start and switches from the
sidebar. Opening IT tickets does not count as a main app (everyone has it), so
those people start in their own app and switch to «التقنية» when needed.

| App | Views | Who |
| --- | --- | --- |
| Customer Service | overview, tickets, refunds, customers, tasks, schedule, reports, QR… | Customer-service roles, branch managers, executives |
| Maintenance | `maintenance`, `maintenance-reports` | Maintenance manager, technicians, branch managers, executives |
| IT | `it`, `it-refunds`, `it-reports` | Everyone (own tickets), IT manager (all), IT specialists (assigned) |

## IT app

- **Tickets** (`it_tickets`, `it_events`, `it_photos`, migration 0018). Any staff
  member opens a ticket: department (required), branch (optional; required for
  the «الفروع» department), problem type, priority, title, details, up to 3
  photos or screenshots. Numbers look like `IT-0021`.
- **Flow**: New → Assigned → In progress → Solved → Confirmed by the requester
  (or reopened). Only the person who opened the ticket confirms or reopens it;
  the IT manager can too. Deadlines per priority (start and solve) mark late
  tickets.
- **Who sees what** (`it_visible`): super admin and IT manager see all tickets,
  an IT specialist sees the tickets assigned to them, everyone sees the tickets
  they opened. IT specialists never see complaints or refunds.
- **Settings** («الأنواع والأقسام والمهل», IT manager): problem types,
  departments and deadlines, stored in `app_settings.it`.
- **Refunds and compensation** (`it-refunds`): the same refunds screen as in
  Customer Service, shown inside the IT app for the IT manager, who executes
  them. Telegram refund alerts open `?view=it-refunds`.
- **Reports** (`it-reports`): by department, branch, problem type, priority and
  specialist, with a CSV export (one row per ticket).
- Code: `src/lib/it.ts`, `src/functions/it.functions.ts`, `src/aliz/it-*.tsx`.

## Group dashboard

`?view=hub` («لوحة المجموعة») shows the three apps on one screen: totals, one
list of what is late or urgent in any app, and a card per app with its numbers
and main actions. It opens for the super admin, CEO and owner, who land on it
after signing in. Each person sees only the apps they may read (`hubSections`
in `src/aliz/access.ts`); the figures are in `src/lib/group-dashboard.ts`.

## Full access

The super admin, CEO and owner have every permission in every brand and branch
(`hasFullAccess` in `src/lib/domain.ts`; the database rules match in migration
`0019_executive_full_access.sql`). Every other role is limited to its own
rights and scope.

## Report exports

The complaints, Maintenance and IT reports export to Excel (`.xlsx`) or CSV.
The Excel file has a summary sheet (filters, totals, and breakdowns by brand,
region, branch, reason or type, and person) and a detail sheet with one row
per item, named by brand, region, city, branch and branch code. Built in
`src/lib/report-export.ts` with the small writer in `src/lib/xlsx.ts` (no
dependency). Customer personal data is never included.

## WhatsApp inbox

«واتساب العملاء» (`?view=inbox`, Customer Service app) shows the WhatsApp
conversations held in Bevatel and lets staff reply. It reads Bevatel's
Chatwoot API with the existing `BEVATEL_*` secrets; messages are not copied
into the CRM database, and only the inbox in `BEVATEL_INBOX_ID` is reachable.
Replies and resolve/reopen are written to the audit log with who did it. It
shows for roles with the `contact` permission once WhatsApp is switched on.
WhatsApp allows free replies only within 24 hours of the customer's last
message; after that the reply box is replaced by a notice. Code:
`src/functions/inbox.server.ts`, `src/aliz/whatsapp-inbox.tsx`.

New WhatsApp chats are assigned automatically to an agent who is on shift
(fewest open chats, then fewest in the last 24 hours, the same rule as
complaints), while staff have the inbox open and by the every-few-minutes job.
Chats wait when nobody is on shift. The owner is kept in
`whatsapp_assignments` (chat id → staff member); shift leads reassign, agents
can claim unassigned chats, and the new owner gets a Telegram alert. It follows
the auto-assignment switch in Settings.

### WhatsApp chat → complaint

When an agent opens a chat, AI (Lovable AI, `LOVABLE_API_KEY`) reads the
customer and staff messages and suggests whether it is a complaint, with the
brand, branch, reason, priority, order number and platform, checked against
the CRM's lists. The suggestion is kept per chat (`whatsapp_complaints`) and
asked again only after the customer writes something new. The agent reviews
the pre-filled form and registers it: source `WHATSAPP`, customer name and
number taken from Bevatel, order number and platform optional, and the
customer receives the complaint number and tracking link on WhatsApp. A
private note is added in Bevatel. Without AI the same form opens empty from
«تسجيل كشكوى». Code: `src/functions/inbox-complaint.server.ts`,
`src/aliz/whatsapp-complaint.tsx`.

## Customer satisfaction (1-5)

Once a complaint is solved (RESOLVED or CLOSED), the customer's tracking page
asks «كيف كانت تجربتك مع معالجة بلاغك؟» with five faces and an optional
comment. The score is kept in `complaint_ratings` (comment encrypted), written
to the complaint history as «تقييم العميل للخدمة», and a 1 or 2 alerts shift
leads and admins on Telegram. The customer can change it (at most 5 times).
Reports show the average, the share of 4-5 scores and a breakdown by score,
brand, branch and staff member; the Excel export adds a score column and an
average per group; the group dashboard shows the last 30 days. Code:
`src/functions/ratings.server.ts`, `src/aliz/tracking.tsx`.

