/**
 * Jarima sababi turi. Faqat guruhlash/hisobot uchun — summani admin har doim
 * o'zi yozadi, tizim avtomatik jarima solmaydi.
 */
export enum StaffDeductionType {
  /** Kechikish yoki ishga kelmaslik */
  LATE = 'late',
  /** Qabul qilingan, lekin adminga topshirilmagan pul */
  UNSETTLED_PAYMENT = 'unsettled_payment',
  /** Boshqa sabab (admin izohda yozadi) */
  OTHER = 'other',
}
