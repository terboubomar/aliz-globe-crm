import { useState } from "react";
import { Phone, X } from "lucide-react";

/*
 * The floating help widget on the customer pages (QR form and tracking): a call
 * button and a WhatsApp button on the customer-service line, with a short note
 * the customer can close.
 */
/** Customer service line shown on the form for urgent issues. */
export const HOTLINE = "920031754";
/** The same line on WhatsApp, in international form for wa.me. */
const WHATSAPP = "966920031754";

export function HelpWidget({ raised, greeting }: { raised: boolean; greeting: string }) {
  const [tip, setTip] = useState(true);
  const whatsappLink = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(greeting)}`;
  return (
    <div className={"qf-call" + (raised ? "" : " done")}>
      {tip && (
        <div className="qf-call-tip" role="note">
          <button type="button" aria-label="إخفاء" onClick={() => setTip(false)}>
            <X size={14} />
          </button>
          <b>عندك مشكلة عاجلة؟</b>
          <a href={"tel:" + HOTLINE}>
            اتصل علينا <span dir="ltr">{HOTLINE}</span>
          </a>
          <a className="wa" href={whatsappLink} target="_blank" rel="noopener noreferrer">
            أو راسلنا واتساب
          </a>
        </div>
      )}
      <div className="qf-call-btns">
        <a
          className="qf-wa-btn"
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={"راسلنا واتساب على " + HOTLINE}
        >
          <WhatsAppIcon />
        </a>
        <a
          className="qf-call-btn"
          href={"tel:" + HOTLINE}
          aria-label={"اتصل بخدمة العملاء " + HOTLINE}
        >
          <Phone size={24} strokeWidth={2} />
        </a>
      </div>
    </div>
  );
}

/** WhatsApp's speech-bubble mark, so customers recognise the button at a glance. */
function WhatsAppIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.43 9.43 0 0 1-4.8-1.31l-.35-.2-3.57.93.95-3.48-.22-.36a9.42 9.42 0 0 1-1.45-5.02c0-5.2 4.24-9.44 9.46-9.44a9.4 9.4 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.77 6.68c0 5.21-4.24 9.44-9.46 9.44zm8.05-17.5A11.3 11.3 0 0 0 12.05.66C5.78.66.67 5.76.67 12.04c0 2 .52 3.96 1.52 5.69L.57 23.66l6.06-1.59a11.36 11.36 0 0 0 5.42 1.38h.01c6.27 0 11.38-5.1 11.38-11.38 0-3.04-1.18-5.9-3.34-8.06z" />
    </svg>
  );
}
