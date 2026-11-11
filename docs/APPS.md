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
