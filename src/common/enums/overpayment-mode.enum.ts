/** Qayta hisoblashda ortiqcha to'langan pul bilan nima qilinadi. */
export enum OverpaymentMode {
  /** O'quvchiga qaytariladi (`refundedAmount`, kassadan chiqadi). */
  REFUND = 'refund',
  /** Keyingi oylarga o'tadi (`creditAmount` → ko'chirish cheki). */
  CARRY = 'carry',
}
