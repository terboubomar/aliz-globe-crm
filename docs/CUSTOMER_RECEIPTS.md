# Customer receipts (WhatsApp and email)

When a customer files a complaint (QR form, or a phone call logged by staff) and
ticks "send me a confirmation", they get one message with the complaint number,
brand, branch, time received (Riyadh), category, order number, a short summary
and their private tracking link.

Nothing is sent until a super admin switches the channel on in
**Settings → Integrations**, and the switch refuses to turn on until every
setting below is in place. The checkbox only appears on the forms while the
channel is live.

## Rules

- Only with the customer's consent, one message per complaint and channel.
- At most 5 receipts per phone number or email address per hour.
- A send that fails with "too many requests" is retried twice by the scheduled
  run. A send whose outcome is unclear (timeout, dropped connection) is marked
  UNKNOWN and never resent, so nobody gets duplicates.
- Receipts not sent within an hour expire.
- WhatsApp delivery reports (sent, delivered, read, failed) update the status;
  Settings shows the counts for the last 30 days.
- No phone numbers, emails or message text are stored outside the complaint's
  encrypted fields, and nothing personal is logged.

## WhatsApp through Bevatel (in use)

When the secret `BEVATEL_API_KEY` is set, WhatsApp messages go through Bevatel
(https://developers.bevatel.com) instead of Meta directly, so they also appear
in the Bevatel inbox and agents can carry on the chat there. A customer who
chose WhatsApp on the form gets three messages:

| When | Template (default name) | Variables |
| --- | --- | --- |
| The complaint or suggestion is received | `aliz_complaint_received` | 1 number, 2 brand, 3 branch, 4 time received (Riyadh), 5 reason, 6 order number, 7 details, 8 tracking link |
| It is resolved | `aliz_complaint_resolved` | 1 number, 2 brand, 3 tracking link |
| It is closed | `aliz_complaint_closed` | 1 number, 2 brand |

How it sends: the CRM finds the active WhatsApp channel (or uses
`BEVATEL_CHANNEL_ID`), looks up the approved template by name, creates the
customer as a Bevatel contact once (remembered by a keyed hash of the number),
then calls `POST /v1/messages/whatsapp/template` with the variables in order.
Each update is sent once per complaint; the same retry, expiry and
"never resend an unclear send" rules apply.

### Templates to create in Bevatel (Business Chat → WhatsApp templates)

Category **Utility**, language **Arabic**, numbered variables.

`aliz_complaint_received`

```
شكراً لتواصلك معنا، تم استلام طلبك رقم {{1}}.
العلامة: {{2}}
الفرع: {{3}}
وقت الاستلام: {{4}}
السبب: {{5}}
رقم الطلب: {{6}}
التفاصيل: {{7}}
تابع حالة طلبك من هنا:
{{8}}
```

Samples: `AG-2026-000123`, `برجر واقف`, `برجر واقف - الدمام`, `11/11/2026 09:30`,
`تأخر الطلب`, `482915`, `وصل الطلب بعد ساعة`, `https://crm.example.com/track/sample`.

`aliz_complaint_resolved`

```
تحديث على طلبك رقم {{1}} لدى {{2}}:
تمت معالجة الطلب، وسيتواصل معك فريقنا للتأكد من رضاك.
تفاصيل الحالة:
{{3}}
```

`aliz_complaint_closed`

```
تم إغلاق طلبك رقم {{1}} لدى {{2}}.
شكراً لتواصلك معنا، يسعدنا خدمتك دائماً.
```

### Secrets for Bevatel

| Secret | What it is |
| --- | --- |
| `BEVATEL_API_KEY` | The access token from Bevatel (Settings → API) |
| `WHATSAPP_TEMPLATE_APPROVED` | `true`, once the three templates show as Approved in Bevatel |
| `PUBLIC_APP_ORIGIN` | The public https address of the CRM (for the tracking link) |
| `BEVATEL_CHANNEL_ID` | Optional: only if Bevatel has more than one WhatsApp channel |
| `BEVATEL_TEMPLATE_RECEIVED` / `_RESOLVED` / `_CLOSED` | Optional: other template names |

## Secrets to add in Lovable Cloud (Project → Cloud → Secrets)

Add values there only, never in chat or in the repository.

| Secret | Channel | What it is |
| --- | --- | --- |
| `PUBLIC_APP_ORIGIN` | both | The public https address of the CRM, e.g. `https://crm.yourdomain.com` (used for the tracking link) |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp | Permanent system-user token from Meta Business Manager |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp | Phone number ID (digits) from WhatsApp Manager → API setup |
| `WHATSAPP_APP_SECRET` | WhatsApp | Meta app secret, used to check delivery reports are genuine |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp | Any long random string; enter the same one in Meta's webhook settings |
| `WHATSAPP_TEMPLATE_NAME` | WhatsApp | `aliz_complaint_received` |
| `WHATSAPP_TEMPLATE_APPROVED` | WhatsApp | `true`, only after Meta shows the template as Approved |
| `WHATSAPP_TEMPLATE_LANGUAGE` | WhatsApp | Optional, default `ar` |
| `LOVABLE_API_KEY` | email | Usually provided by Lovable Cloud already |
| `EMAIL_SENDER_DOMAIN` | email | The sender domain verified in Lovable Cloud → Emails, e.g. `notify.yourdomain.com` |
| `EMAIL_SENDER_NAME` | email | Optional display name, default `Aliz Globe` |

## WhatsApp: template to submit in WhatsApp Manager

- Name: `aliz_complaint_received`
- Category: **Utility**
- Language: Arabic (`ar`)
- Parameter type: **Named**
- Body:

```
تم استلام شكواك {{number}}.
العلامة: {{brand}}
الفرع: {{branch}}
وقت الاستقبال (الرياض): {{received_at}}
التصنيف: {{category}}
رقم الطلب: {{order}}
تفاصيل المشكلة: {{summary}}
للتفاصيل الكاملة ومتابعة الشكوى:
{{tracking_url}}
```

Sample values for review: `123`, `برقر واقف`, `فرع العليا`,
`28/10/2026 11:00`, `تأخير`, `غير محدد`, `وصل الطلب متأخراً`,
`https://crm.yourdomain.com/track/sample`.

## WhatsApp: webhook for delivery reports

In the Meta app → WhatsApp → Configuration:

- Callback URL: `https://<your CRM address>/api/public/webhooks/whatsapp`
- Verify token: the `WHATSAPP_VERIFY_TOKEN` value
- Subscribe to the `messages` field.

## Scheduled run

Ask Lovable to schedule a POST to `/api/public/cron/receipts` every 5 minutes
using the project's cron secret. Receipts are sent immediately when the
complaint is filed; the scheduled run only handles retries, expiry and
unfinished sends.

## Go-live check

1. Add the secrets, then open Settings → Integrations → WhatsApp (or Email):
   the requirements list should be empty.
2. Switch the channel on.
3. File a test complaint on a QR form with your own number or email and the
   consent box ticked. The confirmation page shows the receipt status.
