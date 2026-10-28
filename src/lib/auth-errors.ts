/**
 * Clear Arabic messages for the account errors an admin can fix from the form.
 * Unknown errors keep the provider's code so support can find the cause.
 */
export function accountErrorMessage(
  error: { code?: string; message?: string; reasons?: string[] } | null,
) {
  const code = error?.code ?? "";
  const msg = (error?.message ?? "").toLowerCase();
  if (code === "weak_password" || msg.includes("password")) {
    const reasons = error?.reasons ?? [];
    if (
      reasons.includes("pwned") ||
      msg.includes("pwned") ||
      msg.includes("leaked") ||
      msg.includes("weak and easy")
    )
      return "كلمة المرور ظهرت في تسريبات بيانات سابقة وغير آمنة؛ اختر كلمة مرور مختلفة وفريدة.";
    if (reasons.includes("characters") || msg.includes("character"))
      return "كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم ورمز (مثل ! أو #).";
    if (reasons.includes("length") || msg.includes("length") || msg.includes("at least"))
      return "كلمة المرور أقصر من الحد المطلوب؛ استخدم 12 حرفاً على الأقل.";
    return "كلمة المرور لا تستوفي شروط الأمان؛ استخدم 12 حرفاً على الأقل مع أحرف كبيرة وصغيرة وأرقام ورموز.";
  }
  if (code === "email_exists" || code === "user_already_exists" || msg.includes("already"))
    return "البريد مسجل مسبقاً؛ ابحث عن المستخدم في القائمة وعدّل صلاحياته بدلاً من إنشائه من جديد.";
  if (
    code === "email_address_invalid" ||
    code === "validation_failed" ||
    (msg.includes("invalid") && msg.includes("email"))
  )
    return "البريد الإلكتروني غير مقبول؛ استخدم بريد عمل حقيقياً (لا تُقبل نطاقات تجريبية مثل example.com).";
  if (code === "email_address_not_authorized")
    return "نطاق هذا البريد غير مسموح به في إعدادات تسجيل الدخول.";
  if (
    code.startsWith("over_") ||
    (error && "status" in error && (error as { status?: number }).status === 429)
  )
    return "محاولات كثيرة خلال وقت قصير؛ انتظر دقيقة ثم أعد المحاولة.";
  return `تعذر إنشاء الحساب (${code || "UNKNOWN"}). أعد المحاولة أو تواصل مع الدعم الفني بهذا الرمز.`;
}
