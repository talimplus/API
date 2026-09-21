/**
 * Tizimdagi barcha ruxsatlar (permission) katalogi.
 *
 * Bu — yagona manba (single source of truth). Frontend ham shu ro'yxatni
 * `GET /roles/permissions` orqali oladi, ya'ni yangi permission qo'shilsa
 * frontendda hech narsa qo'lda yozilmaydi.
 *
 * Nomlash qoidasi: `<modul>.<amal>` (masalan `students.create`).
 */

/** Admin roli uchun maxsus kalit — barcha ruxsatlarni bildiradi. */
export const ALL_PERMISSIONS = '*';

export interface PermissionDef {
  /** `<modul>.<amal>` ko'rinishidagi unikal kalit */
  key: string;
  /** UI'da checkbox nomi */
  label: { uz: string; ru: string };
}

export interface PermissionGroupDef {
  /** Guruh kaliti (UI'da akkordeon sarlavhasi) */
  key: string;
  label: { uz: string; ru: string };
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroupDef[] = [
  {
    key: 'dashboard',
    label: { uz: 'Statistika', ru: 'Статистика' },
    permissions: [
      {
        key: 'statistics.view',
        label: { uz: 'Statistikani ko‘rish', ru: 'Просмотр статистики' },
      },
    ],
  },
  {
    key: 'users',
    label: { uz: 'Xodimlar', ru: 'Сотрудники' },
    permissions: [
      {
        key: 'users.view',
        label: { uz: 'Xodimlarni ko‘rish', ru: 'Просмотр сотрудников' },
      },
      {
        key: 'users.create',
        label: { uz: 'Xodim qo‘shish', ru: 'Добавление сотрудника' },
      },
      {
        key: 'users.update',
        label: { uz: 'Xodimni tahrirlash', ru: 'Редактирование сотрудника' },
      },
      {
        key: 'users.delete',
        label: { uz: 'Xodimni o‘chirish', ru: 'Удаление сотрудника' },
      },
    ],
  },
  {
    key: 'roles',
    label: { uz: 'Rollar va ruxsatlar', ru: 'Роли и права' },
    permissions: [
      {
        key: 'roles.view',
        label: { uz: 'Rollarni ko‘rish', ru: 'Просмотр ролей' },
      },
      {
        key: 'roles.manage',
        label: {
          uz: 'Rollarni yaratish/tahrirlash/o‘chirish',
          ru: 'Создание/редактирование/удаление ролей',
        },
      },
    ],
  },
  {
    key: 'students',
    label: { uz: 'O‘quvchilar', ru: 'Ученики' },
    permissions: [
      {
        key: 'students.view',
        label: { uz: 'O‘quvchilarni ko‘rish', ru: 'Просмотр учеников' },
      },
      {
        key: 'students.create',
        label: { uz: 'O‘quvchi qo‘shish', ru: 'Добавление ученика' },
      },
      {
        key: 'students.update',
        label: { uz: 'O‘quvchini tahrirlash', ru: 'Редактирование ученика' },
      },
      {
        key: 'students.delete',
        label: { uz: 'O‘quvchini o‘chirish', ru: 'Удаление ученика' },
      },
      {
        key: 'students.changeStatus',
        label: {
          uz: 'O‘quvchi statusini o‘zgartirish',
          ru: 'Изменение статуса ученика',
        },
      },
      {
        key: 'students.discounts',
        label: { uz: 'Chegirmalarni boshqarish', ru: 'Управление скидками' },
      },
      {
        key: 'students.transfer',
        label: {
          uz: 'Boshqa guruhga ko‘chirish',
          ru: 'Перевод в другую группу',
        },
      },
    ],
  },
  {
    key: 'leads',
    label: { uz: 'Lidlar (qabul)', ru: 'Лиды (приём)' },
    permissions: [
      {
        key: 'leads.view',
        label: { uz: 'Lidlarni ko‘rish', ru: 'Просмотр лидов' },
      },
      {
        key: 'leads.create',
        label: { uz: 'Lid qo‘shish', ru: 'Добавление лида' },
      },
      {
        key: 'leads.update',
        label: { uz: 'Lidni tahrirlash', ru: 'Редактирование лида' },
      },
      {
        key: 'leads.delete',
        label: { uz: 'Lidni o‘chirish', ru: 'Удаление лида' },
      },
      {
        key: 'leads.transfer',
        label: {
          uz: 'Lidni o‘quvchiga o‘tkazish',
          ru: 'Перевод лида в ученика',
        },
      },
    ],
  },
  {
    key: 'groups',
    label: { uz: 'Guruhlar', ru: 'Группы' },
    permissions: [
      {
        key: 'groups.view',
        label: { uz: 'Guruhlarni ko‘rish', ru: 'Просмотр групп' },
      },
      {
        key: 'groups.create',
        label: { uz: 'Guruh yaratish', ru: 'Создание группы' },
      },
      {
        key: 'groups.update',
        label: { uz: 'Guruhni tahrirlash', ru: 'Редактирование группы' },
      },
      {
        key: 'groups.delete',
        label: { uz: 'Guruhni o‘chirish', ru: 'Удаление группы' },
      },
      {
        key: 'groups.changeStatus',
        label: {
          uz: 'Guruh statusini o‘zgartirish',
          ru: 'Изменение статуса группы',
        },
      },
    ],
  },
  {
    key: 'attendance',
    label: { uz: 'Davomat', ru: 'Посещаемость' },
    permissions: [
      {
        key: 'attendance.view',
        label: { uz: 'Davomatni ko‘rish', ru: 'Просмотр посещаемости' },
      },
      {
        key: 'attendance.manage',
        label: { uz: 'Davomat belgilash', ru: 'Отметка посещаемости' },
      },
      {
        key: 'attendance.managePast',
        label: {
          uz: 'O‘tgan sanalarda davomat belgilash',
          ru: 'Отметка за прошедшие даты',
        },
      },
    ],
  },
  {
    key: 'schedule',
    label: { uz: 'Dars jadvali', ru: 'Расписание' },
    permissions: [
      {
        key: 'schedule.view',
        label: { uz: 'Jadvalni ko‘rish', ru: 'Просмотр расписания' },
      },
      {
        key: 'schedule.manage',
        label: { uz: 'Jadvalni boshqarish', ru: 'Управление расписанием' },
      },
    ],
  },
  {
    key: 'syllabus',
    label: { uz: 'Kurs rejasi', ru: 'Учебный план' },
    permissions: [
      {
        key: 'syllabus.view',
        label: { uz: 'Kurs rejasini ko‘rish', ru: 'Просмотр учебного плана' },
      },
      {
        key: 'syllabus.manage',
        label: {
          uz: 'Kurs rejasi va mavzularni boshqarish',
          ru: 'Управление планом и темами',
        },
      },
      {
        key: 'syllabus.ai',
        label: {
          uz: 'AI yordamida reja tuzish',
          ru: 'Составление плана с помощью AI',
        },
      },
      {
        key: 'groupPlan.view',
        label: { uz: 'Guruh rejasini ko‘rish', ru: 'Просмотр плана группы' },
      },
      {
        key: 'groupPlan.manage',
        label: {
          uz: 'Guruh rejasini boshqarish (mavzu biriktirish)',
          ru: 'Управление планом группы',
        },
      },
      {
        key: 'groupPlan.attach',
        label: {
          uz: 'Guruhga kurs rejasini biriktirish/almashtirish',
          ru: 'Привязка/смена учебного плана группы',
        },
      },
    ],
  },
  {
    key: 'payments',
    label: { uz: 'To‘lovlar', ru: 'Платежи' },
    permissions: [
      {
        key: 'payments.view',
        label: { uz: 'To‘lovlarni ko‘rish', ru: 'Просмотр платежей' },
      },
      {
        key: 'payments.create',
        label: { uz: 'To‘lov qabul qilish', ru: 'Приём платежа' },
      },
      {
        key: 'payments.update',
        label: { uz: 'To‘lovni tahrirlash', ru: 'Редактирование платежа' },
      },
      {
        key: 'payments.delete',
        label: { uz: 'To‘lovni o‘chirish', ru: 'Удаление платежа' },
      },
      {
        key: 'payments.export',
        label: { uz: 'To‘lovlarni eksport qilish', ru: 'Экспорт платежей' },
      },
      {
        key: 'payments.recalculate',
        label: { uz: 'To‘lovni qayta hisoblash', ru: 'Пересчёт платежа' },
      },
      {
        key: 'payments.exclusion',
        label: {
          uz: 'To‘lovdan darslarni chiqarib tashlash',
          ru: 'Исключение уроков из платежа',
        },
      },
    ],
  },
  {
    key: 'receipts',
    label: { uz: 'Cheklar (tasdiqlash)', ru: 'Чеки (подтверждение)' },
    permissions: [
      {
        key: 'receipts.view',
        label: { uz: 'Cheklarni ko‘rish', ru: 'Просмотр чеков' },
      },
      {
        key: 'receipts.confirm',
        label: { uz: 'Chekni tasdiqlash', ru: 'Подтверждение чека' },
      },
      {
        key: 'receipts.reject',
        label: { uz: 'Chekni rad etish', ru: 'Отклонение чека' },
      },
    ],
  },
  {
    key: 'payroll',
    label: { uz: 'Oylik (xodimlar)', ru: 'Зарплата' },
    permissions: [
      {
        key: 'payroll.view',
        label: { uz: 'Oyliklarni ko‘rish', ru: 'Просмотр зарплат' },
      },
      {
        key: 'payroll.pay',
        label: { uz: 'Oylik to‘lash', ru: 'Выплата зарплаты' },
      },
      {
        key: 'payroll.deduct',
        label: {
          uz: 'Oylikdan ushlab qolish (jarima)',
          ru: 'Удержание из зарплаты (штраф)',
        },
      },
      {
        key: 'payroll.calculate',
        label: {
          uz: 'O‘qituvchi daromadini hisoblash',
          ru: 'Расчёт дохода преподавателя',
        },
      },
    ],
  },
  {
    key: 'expenses',
    label: { uz: 'Xarajatlar', ru: 'Расходы' },
    permissions: [
      {
        key: 'expenses.view',
        label: { uz: 'Xarajatlarni ko‘rish', ru: 'Просмотр расходов' },
      },
      {
        key: 'expenses.create',
        label: { uz: 'Xarajat qo‘shish', ru: 'Добавление расхода' },
      },
      {
        key: 'expenses.update',
        label: { uz: 'Xarajatni tahrirlash', ru: 'Редактирование расхода' },
      },
      {
        key: 'expenses.delete',
        label: { uz: 'Xarajatni o‘chirish', ru: 'Удаление расхода' },
      },
    ],
  },
  {
    key: 'settings',
    label: { uz: 'Sozlamalar', ru: 'Настройки' },
    permissions: [
      {
        key: 'organization.settings',
        label: {
          uz: 'O‘quv markazi brendi (nom, logo, favicon)',
          ru: 'Бренд учебного центра (название, логотип, favicon)',
        },
      },
      {
        key: 'centers.view',
        label: { uz: 'Filiallarni ko‘rish', ru: 'Просмотр филиалов' },
      },
      {
        key: 'centers.manage',
        label: { uz: 'Filiallarni boshqarish', ru: 'Управление филиалами' },
      },
      {
        key: 'rooms.view',
        label: { uz: 'Xonalarni ko‘rish', ru: 'Просмотр кабинетов' },
      },
      {
        key: 'rooms.manage',
        label: { uz: 'Xonalarni boshqarish', ru: 'Управление кабинетами' },
      },
      {
        key: 'subjects.view',
        label: { uz: 'Fanlarni ko‘rish', ru: 'Просмотр предметов' },
      },
      {
        key: 'subjects.manage',
        label: { uz: 'Fanlarni boshqarish', ru: 'Управление предметами' },
      },
    ],
  },
  {
    key: 'telegram',
    label: { uz: 'Telegram bot', ru: 'Telegram-бот' },
    permissions: [
      {
        key: 'telegram.settings',
        label: {
          uz: 'Ota-onalar boti sozlamalari',
          ru: 'Настройки бота для родителей',
        },
      },
    ],
  },
  {
    key: 'staffPerformance',
    label: { uz: 'Xodim faoliyati', ru: 'Работа сотрудника' },
    permissions: [
      {
        key: 'staffPerformance.view',
        label: {
          uz: 'Xodim sahifasini ko‘rish (davomat, qarz, jarimalar)',
          ru: 'Просмотр страницы сотрудника (посещаемость, долги, штрафы)',
        },
      },
    ],
  },
  {
    key: 'staffAttendance',
    label: { uz: 'Xodimlar davomati', ru: 'Посещаемость сотрудников' },
    permissions: [
      {
        key: 'staffAttendance.checkIn',
        label: {
          uz: '“Keldim” belgilash',
          ru: 'Отметка «Пришёл»',
        },
      },
      {
        key: 'staffAttendance.viewOwn',
        label: {
          uz: 'O‘z davomatini ko‘rish',
          ru: 'Просмотр своей посещаемости',
        },
      },
      {
        key: 'staffAttendance.view',
        label: {
          uz: 'Barcha xodimlar davomatini ko‘rish',
          ru: 'Просмотр посещаемости всех сотрудников',
        },
      },
      {
        key: 'staffAttendance.manage',
        label: {
          uz: 'Davomatni tasdiqlash va qo‘lda kiritish',
          ru: 'Подтверждение и ручной ввод посещаемости',
        },
      },
    ],
  },
  {
    key: 'teacher',
    label: { uz: 'O‘qituvchi kabineti', ru: 'Кабинет преподавателя' },
    permissions: [
      {
        key: 'teacher.today',
        label: { uz: 'Bugungi darslarim', ru: 'Мои уроки на сегодня' },
      },
    ],
  },
];

/** Katalogdagi barcha permission kalitlari (tekis ro'yxat). */
export const PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
);

const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);

/** Kalit katalogda bor-yo'qligini tekshiradi (DTO validatsiyasi uchun). */
export const isKnownPermission = (key: string): boolean =>
  key === ALL_PERMISSIONS || PERMISSION_KEY_SET.has(key);
