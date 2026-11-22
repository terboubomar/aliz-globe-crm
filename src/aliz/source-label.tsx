import { MessageCircle, Phone, QrCode, Star } from "lucide-react";

// Where a complaint came from: the branch QR form, a phone call logged by an
// agent, a low Google review, or a WhatsApp chat.
const LABELS: Record<string, { short: string; long: string; team: string }> = {
  PUBLIC_QR: { short: "QR", long: "رمز QR", team: "QR من العميل" },
  PHONE_AGENT: { short: "الهاتف", long: "شكوى هاتفية", team: "مركز الاتصال" },
  GOOGLE_REVIEW: { short: "Google", long: "تقييم Google", team: "تقييم Google" },
  WHATSAPP: { short: "واتساب", long: "واتساب", team: "واتساب" },
};

export function sourceLabel(source: string, style: "short" | "long" | "team" = "short") {
  return (LABELS[source] ?? LABELS["PHONE_AGENT"]!)[style];
}

export function SourceIcon({ source, size = 13 }: { source: string; size?: number }) {
  if (source === "GOOGLE_REVIEW") return <Star size={size} />;
  if (source === "WHATSAPP") return <MessageCircle size={size} />;
  return source === "PUBLIC_QR" ? <QrCode size={size} /> : <Phone size={size} />;
}
