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
