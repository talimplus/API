/**
 * Botdan ota-onaga ketadigan barcha matnlar — bitta joyda.
 *
 * Til Telegram profilidan olinadi (`language_code`): `ru` bo'lsa ruscha,
 * qolgan hamma holatda o'zbekcha (markazning asosiy tili).
 */

export type BotLang = 'uz' | 'ru';

export const pickLang = (languageCode?: string | null): BotLang =>
  languageCode?.toLowerCase().startsWith('ru') ? 'ru' : 'uz';

const MONTHS: Record<BotLang, string[]> = {
  uz: [
    'yanvar',
    'fevral',
    'mart',
    'aprel',
    'may',
    'iyun',
    'iyul',
    'avgust',
    'sentabr',
    'oktabr',
    'noyabr',
    'dekabr',
  ],
  ru: [
    'январь',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь',
  ],
};

/** `2026-09-01` → `2026-sentabr` / `сентябрь 2026` */
export const formatMonth = (value: Date | string, lang: BotLang): string => {
  const iso =
    typeof value === 'string' ? value : (toIsoDate(value) ?? String(value));
  const [year, month] = iso.split('-');
  const name = MONTHS[lang][Number(month) - 1] ?? month;
  return lang === 'ru' ? `${name} ${year}` : `${year}-${name}`;
};

export const toIsoDate = (value?: Date | string | null): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** 500000 → `500 000 so'm` / `500 000 сум` */
export const money = (amount: number, lang: BotLang): string => {
  const rounded = Math.round(Number(amount ?? 0) * 100) / 100;
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(rounded);
  return lang === 'ru' ? `${formatted} сум` : `${formatted} so'm`;
};

/** HTML parse_mode uchun — ism/izohda `<` yoki `&` bo'lishi mumkin */
export const esc = (value?: string | null): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// ── Suhbat (bot buyruqlari) ───────────────────────────────────────

export const T = {
  linked: (lang: BotLang, student: string, center: string) =>
    lang === 'ru'
      ? `✅ Готово! Вы подключены к <b>${esc(student)}</b>.\n` +
        `🏫 Учебный центр: ${esc(center)}\n\n` +
        `Теперь вы будете получать уведомления об оплатах.\n` +
        `Команды: /status — состояние, /stop — отключиться.`
      : `✅ Tayyor! Siz <b>${esc(student)}</b> ga ulandingiz.\n` +
        `🏫 O'quv markaz: ${esc(center)}\n\n` +
        `Endi to'lovlar haqida xabar shu yerga keladi.\n` +
        `Buyruqlar: /status — holat, /stop — uzish.`,

  alreadyLinked: (lang: BotLang, student: string) =>
    lang === 'ru'
      ? `ℹ️ Вы уже подключены к <b>${esc(student)}</b>.`
      : `ℹ️ Siz allaqachon <b>${esc(student)}</b> ga ulangansiz.`,

  invalidToken: (lang: BotLang) =>
    lang === 'ru'
      ? `❌ QR-код недействителен или устарел.\n\nПопросите в учебном центре новый QR-код.`
      : `❌ QR kod yaroqsiz yoki eskirgan.\n\nO'quv markazdan yangi QR kod so'rang.`,

  noPayload: (lang: BotLang) =>
    lang === 'ru'
      ? `👋 Здравствуйте!\n\nЭтот бот отправляет родителям уведомления об оплате.\n\n` +
        `Чтобы подключиться, отсканируйте QR-код со страницы ученика в учебном центре.`
      : `👋 Assalomu alaykum!\n\nBu bot ota-onalarga to'lov haqida xabar yuboradi.\n\n` +
        `Ulanish uchun o'quv markazdagi o'quvchi sahifasidagi QR kodni skaner qiling.`,

  help: (lang: BotLang) =>
    lang === 'ru'
      ? `ℹ️ Команды:\n/status — к кому вы подключены\n/stop — отключить уведомления\n\n` +
        `Чтобы подключить ещё одного ребёнка — отсканируйте его QR-код.`
      : `ℹ️ Buyruqlar:\n/status — kimga ulangansiz\n/stop — xabarlarni uzish\n\n` +
        `Yana bir farzandni ulash uchun uning QR kodini skaner qiling.`,

  statusNone: (lang: BotLang) =>
    lang === 'ru'
      ? `У вас нет активных подключений. Отсканируйте QR-код ученика.`
      : `Sizda faol ulanish yo'q. O'quvchining QR kodini skaner qiling.`,

  statusHeader: (lang: BotLang) =>
    lang === 'ru' ? `<b>Ваши подключения</b>` : `<b>Ulangan o'quvchilar</b>`,

  statusLine: (lang: BotLang, student: string, debt: number) =>
    debt > 0
      ? lang === 'ru'
        ? `• ${esc(student)} — долг: ${money(debt, lang)}`
        : `• ${esc(student)} — qarz: ${money(debt, lang)}`
      : lang === 'ru'
        ? `• ${esc(student)} — долгов нет ✅`
        : `• ${esc(student)} — qarz yo'q ✅`,

  stopped: (lang: BotLang) =>
    lang === 'ru'
      ? `🔕 Уведомления отключены. Чтобы снова подключиться — отсканируйте QR-код.`
      : `🔕 Xabarlar uzildi. Qayta ulanish uchun QR kodni skaner qiling.`,

  stopNone: (lang: BotLang) =>
    lang === 'ru'
      ? `У вас и так нет активных подключений.`
      : `Sizda faol ulanish yo'q edi.`,

  unknown: (lang: BotLang) =>
    lang === 'ru'
      ? `Не понял команду. /help — список команд.`
      : `Buyruq tushunarsiz. /help — buyruqlar ro'yxati.`,
};

// ── Xabarnomalar ──────────────────────────────────────────────────

export interface PaymentMessageData {
  studentName: string;
  centerName: string;
  groupName: string | null;
  forMonth: Date | string;
  amount: number;
  checkNo: string | null;
  /** Shu oy bo'yicha qolgan qarz */
  remaining: number;
  /** Tasdiq kutilyaptimi (pending) */
  pending: boolean;
}

export const paymentMessage = (
  lang: BotLang,
  d: PaymentMessageData,
  kind: 'received' | 'confirmed',
): string => {
  const lines: string[] = [];
  const title =
    kind === 'received'
      ? lang === 'ru'
        ? '💰 <b>Оплата принята</b>'
        : "💰 <b>To'lov qabul qilindi</b>"
      : lang === 'ru'
        ? '✅ <b>Оплата подтверждена</b>'
        : "✅ <b>To'lov tasdiqlandi</b>";
  lines.push(title, '');
  lines.push(`👤 ${esc(d.studentName)}`);
  if (d.groupName) {
    lines.push(
      lang === 'ru'
        ? `📚 Группа: ${esc(d.groupName)}`
        : `📚 Guruh: ${esc(d.groupName)}`,
    );
  }
  lines.push(
    lang === 'ru'
      ? `🗓 Месяц: ${formatMonth(d.forMonth, lang)}`
      : `🗓 Oy: ${formatMonth(d.forMonth, lang)}`,
  );
  lines.push(
    lang === 'ru'
      ? `💵 Сумма: <b>${money(d.amount, lang)}</b>`
      : `💵 Summa: <b>${money(d.amount, lang)}</b>`,
  );
  if (d.checkNo) {
    lines.push(
      lang === 'ru'
        ? `🧾 Чек: ${esc(d.checkNo)}`
        : `🧾 Chek: ${esc(d.checkNo)}`,
    );
  }
  lines.push(
    d.remaining > 0
      ? lang === 'ru'
        ? `📌 Остаток за месяц: ${money(d.remaining, lang)}`
        : `📌 Shu oy uchun qoldiq: ${money(d.remaining, lang)}`
      : lang === 'ru'
        ? `📌 Месяц оплачен полностью ✅`
        : `📌 Oy to'liq to'landi ✅`,
  );
  if (kind === 'received' && d.pending) {
    lines.push(
      '',
      lang === 'ru'
        ? `<i>Ожидает подтверждения администратора.</i>`
        : `<i>Admin tasdig'i kutilmoqda.</i>`,
    );
  }
  lines.push('', `🏫 ${esc(d.centerName)}`);
  return lines.join('\n');
};

export const paymentRejectedMessage = (
  lang: BotLang,
  d: Pick<
    PaymentMessageData,
    'studentName' | 'centerName' | 'forMonth' | 'amount' | 'checkNo'
  >,
): string => {
  const lines: string[] = [];
  lines.push(
    lang === 'ru'
      ? '⚠️ <b>Оплата отменена</b>'
      : "⚠️ <b>To'lov bekor qilindi</b>",
    '',
  );
  lines.push(`👤 ${esc(d.studentName)}`);
  lines.push(
    lang === 'ru'
      ? `🗓 Месяц: ${formatMonth(d.forMonth, lang)}`
      : `🗓 Oy: ${formatMonth(d.forMonth, lang)}`,
  );
  lines.push(
    lang === 'ru'
      ? `💵 Сумма: ${money(d.amount, lang)}`
      : `💵 Summa: ${money(d.amount, lang)}`,
  );
  if (d.checkNo) {
    lines.push(
      lang === 'ru'
        ? `🧾 Чек: ${esc(d.checkNo)}`
        : `🧾 Chek: ${esc(d.checkNo)}`,
    );
  }
  lines.push(
    '',
    lang === 'ru'
      ? `Администратор не подтвердил этот платёж. Пожалуйста, уточните в учебном центре.`
      : `Admin bu to'lovni tasdiqlamadi. Iltimos, o'quv markaz bilan bog'laning.`,
  );
  lines.push('', `🏫 ${esc(d.centerName)}`);
  return lines.join('\n');
};

export const absenceMessage = (
  lang: BotLang,
  d: {
    studentName: string;
    centerName: string;
    groupName: string | null;
    lessonDate: string;
    late: boolean;
  },
): string => {
  const lines: string[] = [];
  lines.push(
    d.late
      ? lang === 'ru'
        ? '🕒 <b>Опоздание на урок</b>'
        : '🕒 <b>Darsga kechikdi</b>'
      : lang === 'ru'
        ? '❗️ <b>Пропуск урока</b>'
        : '❗️ <b>Darsga kelmadi</b>',
    '',
  );
  lines.push(`👤 ${esc(d.studentName)}`);
  if (d.groupName) {
    lines.push(
      lang === 'ru'
        ? `📚 Группа: ${esc(d.groupName)}`
        : `📚 Guruh: ${esc(d.groupName)}`,
    );
  }
  lines.push(
    lang === 'ru' ? `🗓 Дата: ${d.lessonDate}` : `🗓 Sana: ${d.lessonDate}`,
  );
  lines.push('', `🏫 ${esc(d.centerName)}`);
  return lines.join('\n');
};

export const debtMessage = (
  lang: BotLang,
  d: {
    studentName: string;
    centerName: string;
    total: number;
    rows: {
      groupName: string | null;
      forMonth: Date | string;
      amount: number;
    }[];
  },
): string => {
  const lines: string[] = [];
  lines.push(
    lang === 'ru'
      ? '🔔 <b>Напоминание об оплате</b>'
      : "🔔 <b>To'lov eslatmasi</b>",
    '',
  );
  lines.push(`👤 ${esc(d.studentName)}`);
  for (const row of d.rows) {
    const label = row.groupName ? `${esc(row.groupName)} · ` : '';
    lines.push(
      `• ${label}${formatMonth(row.forMonth, lang)} — ${money(row.amount, lang)}`,
    );
  }
  lines.push(
    '',
    lang === 'ru'
      ? `💵 Всего к оплате: <b>${money(d.total, lang)}</b>`
      : `💵 Jami qarz: <b>${money(d.total, lang)}</b>`,
  );
  lines.push('', `🏫 ${esc(d.centerName)}`);
  return lines.join('\n');
};
