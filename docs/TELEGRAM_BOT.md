# Telegram bot for staff

Each staff member links their own Telegram account and then receives:

| Who | Message | When |
| --- | --- | --- |
| Everyone linked | Reminder of today's shift (times, break, lead) and how many complaints they have open | Within the hour before the shift starts |
| Everyone linked | Their schedule for next week | Saturday from 8 PM (Riyadh) |
| Staff | "A complaint was assigned to you", with the acknowledgement deadline and two buttons: **✅ استلمتها — بدء العمل** (received, start work) and **فتح الشكوى** (open) | When a complaint is assigned (automatically, by a manager, or by escalation) |
| Staff | "Deadline is close" | When a deadline (first action, acknowledgement, fix) reaches its warning time |
| Staff + super admin | "Deadline missed", with who owns it | When the deadline passes and the step is still not done |
| Super admin | Every new complaint and who it was assigned to (P1 marked urgent) | When the complaint is filed |
| Super admin | Daily summary: new today, open, unassigned, P1, past deadline, and a line per brand | 9 AM to noon (Riyadh), once a day |

Every message is sent once, however often the scheduled run fires.

**Menu buttons** sit under the message box, so nobody has to type commands:
ورديتي اليوم، شكاواي، جدولي هذا الأسبوع، الأسبوع القادم، and for super admins
الملخص، المناوبون الآن، بدون مسؤول. The same answers are available as commands:
`/today`, `/week`, `/next`, `/cases`, and for super admins `/summary`, `/team`
(who is on duty now, their open complaints, who is on a break) and
`/unassigned` (open complaints with no owner, with buttons to open them).

**The only action possible from Telegram** is "received — start work" on a
complaint assigned to the person pressing it. It runs the same action as the
CRM's "بدء العمل" with the same permission checks, as that person, and is
recorded in the complaint history ("تم الاستلام وبدء العمل عبر تيليجرام").
Everything else is done in the CRM.

No customer names, phone numbers or complaint text are sent to Telegram, and
messages are marked as protected (no forwarding or saving).

## Setup (once)

1. In Telegram, open **@BotFather**, send `/newbot`, choose a name and a
   username ending in `bot`. BotFather replies with a token.
2. In Lovable Cloud → Secrets, add (never paste them in chat):
   - `TELEGRAM_BOT_TOKEN`: the token from BotFather
   - `TELEGRAM_BOT_USERNAME`: the bot's username without `@`
   - `TELEGRAM_WEBHOOK_SECRET`: a random string of 32+ letters/digits
   - `PUBLIC_APP_ORIGIN`: the CRM's https address (if not already set)
3. In the CRM: Settings → Integrations → Telegram → **ربط البوت بالنظام**
   (connect the bot), then **تفعيل البوت** (turn on).
4. Ask Lovable to schedule a POST to `/api/public/cron/telegram` with the
   project's cron secret, **every 10 minutes** (hourly also works, but
   deadline alerts then arrive up to an hour late). Assignment and
   new-complaint alerts, the buttons and the commands work without it; shift
   reminders, deadline alerts, the weekly schedule and the daily summary need it.
5. Press **إرسال رسالة تجريبية لي** (send me a test message) after linking your
   own account to check everything end to end.

The Telegram panel in Settings also shows what Telegram reports about the
connection (connected or not, the last error in the past day, updates waiting).

**Upgrading from the first version:** press **إعادة ربط البوت بالنظام** once,
so Telegram starts delivering button presses; the panel shows a reminder until
this is done.

## Linking (each staff member)

Menu → **حسابي على تيليجرام** → **ربط حسابي بتيليجرام** → open the bot and
press Start → back in the CRM, confirm it is your account. The link is valid
for 10 minutes and works once. **إلغاء الربط** stops all messages.
