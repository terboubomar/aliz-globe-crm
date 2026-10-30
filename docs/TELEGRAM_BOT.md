# Telegram bot for staff

Each staff member links their own Telegram account and then receives:

| Who | Message | When |
| --- | --- | --- |
| Everyone linked | Reminder of today's shift (times, break, lead) | About an hour before the shift starts |
| Everyone linked | Their schedule for next week | Saturday 8–9 PM (Riyadh) |
| Staff | "A complaint was assigned to you" with an Open button | When a complaint is assigned (automatically or by a manager) |
| Super admin | Every new complaint and who it was assigned to (P1 marked urgent) | When the complaint is filed |
| Super admin | Daily summary (new today, open, unassigned, P1, past deadline) | 9–10 AM (Riyadh) |

Commands in the bot: `/today`, `/week`, `/next`, `/cases`, and for super
admins `/summary` and `/team` (who is on duty right now).

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
4. Ask Lovable to schedule an hourly POST to `/api/public/cron/telegram` with
   the project's cron secret. Assignment and new-complaint alerts and the
   commands work without it; shift reminders, the weekly schedule and the
   daily summary need it.

## Linking (each staff member)

Menu → **حسابي على تيليجرام** → **ربط حسابي بتيليجرام** → open the bot and
press Start → back in the CRM, confirm it is your account. The link is valid
for 10 minutes and works once. **إلغاء الربط** stops all messages.
