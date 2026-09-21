/** Yozuv qayerdan paydo bo'ldi */
export enum AttendanceSource {
  /** Xodimning o'zi ilovadan "Keldim" bosgan */
  SELF = 'self',
  /** Qabulxona/admin xodim o'rniga belgilagan */
  RECEPTION = 'reception',
  /** Admin keyinchalik qo'lda kiritgan (telefoni o'chgan, internet yo'q va h.k.) */
  MANUAL = 'manual',
}

/**
 * Yozuvga qanchalik ishonish mumkin.
 *
 * Bu **bloklamaydi** — faqat hisobotda ajratib ko'rsatiladi. Maqsad: "yo'lda
 * turib bosib qo'ydim" holatini egaga ko'rinadigan qilish.
 */
export enum AttendanceConfidence {
  /** Markaz Wi-Fi'si ham, GPS ham mos / yoki qabulxona tasdiqlagan */
  HIGH = 'high',
  /** Ikkisidan faqat bittasi mos (yoki markaz sozlanmagan) */
  MEDIUM = 'medium',
  /** Hech biri mos emas yoki joylashuvga ruxsat berilmagan */
  LOW = 'low',
}

/**
 * Yozuvdagi shubhali holatlar. Hisobotda foydalanuvchiga tushunarli matnga
 * aylantiriladi (frontda `staffAttendance.flags.*` tarjimasi).
 */
export enum AttendanceFlag {
  /** Brauzerda joylashuvga ruxsat berilmagan */
  NO_GEO = 'no_geo',
  /** GPS aniqligi juda past (>500 m) — radius tekshiruvi ishonchsiz */
  LOW_GPS_ACCURACY = 'low_gps_accuracy',
  /** Markaz radiusidan tashqarida */
  FAR_FROM_CENTER = 'far_from_center',
  /** Markaz Wi-Fi'sida emas (IP mos kelmadi) */
  IP_MISMATCH = 'ip_mismatch',
  /** Markazga joylashuv/IP kiritilmagan — tekshirib bo'lmadi */
  CENTER_NOT_CONFIGURED = 'center_not_configured',
  /** Shu qurilmadan boshqa xodim ham check-in qilgan */
  SHARED_DEVICE = 'shared_device',
  /** Bugun darsi yo'q edi */
  NO_LESSON_TODAY = 'no_lesson_today',
}
