/**
 * O'quvchi tarixidagi voqea turlari. Front shu qiymatlarga qarab sarlavha va
 * ikonka tanlaydi — qiymatlar o'zgartirilsa frontdagi enum ham yangilanadi.
 */
export enum StudentTimelineType {
  // Boshqa jadvallardan yig'iladigan (eski tarix ham ko'rinadi)
  LEAD_CREATED = 'lead_created',
  CREATED = 'created',
  ACTIVATED = 'activated',
  GROUP_JOINED = 'group_joined',
  GROUP_LEFT = 'group_left',
  TRANSFERRED = 'transferred',
  PAYMENT_RECEIVED = 'payment_received',
  PAYMENT_REFUNDED = 'payment_refunded',
  DISCOUNT_PERIOD = 'discount_period',
  FEE_CHANGED = 'fee_changed',
  REFERRED = 'referred',
  TELEGRAM_LINKED = 'telegram_linked',
  TELEGRAM_UNLINKED = 'telegram_unlinked',
  ATTENDANCE = 'attendance',
  // Faqat `student_events` jurnalidan (shu funksiya qo'shilgandan keyin)
  STATUS_CHANGED = 'status_changed',
  PROFILE_UPDATED = 'profile_updated',
  PAYMENT_EXCLUDED = 'payment_excluded',
}

/** `student_events.type` ga yoziladigan turlar (jurnal). */
export enum StudentEventType {
  STATUS_CHANGED = 'status_changed',
  PROFILE_UPDATED = 'profile_updated',
  TRANSFERRED = 'transferred',
  PAYMENT_EXCLUDED = 'payment_excluded',
}

/** Frontdagi filtr bo'limlari. Ruxsat ham shu bo'yicha tekshiriladi. */
export enum StudentTimelineCategory {
  STATUS = 'status',
  GROUPS = 'groups',
  PAYMENTS = 'payments',
  ATTENDANCE = 'attendance',
  PROFILE = 'profile',
}
