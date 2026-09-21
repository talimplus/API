import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '@/modules/payments/entities/payment.entity';
import {
  PaymentReceipt,
  PaymentReceiptStatus,
} from '@/modules/payments/entities/payment-receipt.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramLinksService } from './telegram-links.service';
import { TelegramSettingsService } from './telegram-settings.service';
import {
  BotLang,
  absenceMessage,
  debtMessage,
  paymentMessage,
  paymentRejectedMessage,
  pickLang,
} from './telegram.messages';

/**
 * Ota-onaga ketadigan xabarnomalar.
 *
 * **Muhim tamoyil:** bu servisning hech bir metodi xato tashlamaydi. Telegram
 * ishlamay qolsa ham to'lov qabul qilish, davomat yozish va boshqa amallar
 * to'xtamasligi kerak — bot ikkinchi darajali kanal.
 */
@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  constructor(
    @InjectRepository(PaymentReceipt)
    private readonly receiptRepo: Repository<PaymentReceipt>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly botService: TelegramBotService,
    private readonly linksService: TelegramLinksService,
    private readonly settingsService: TelegramSettingsService,
  ) {}

  // ── To'lov ────────────────────────────────────────────────────

  /**
   * Chek bo'yicha xabar. `kind`:
   *  - `received`  — pul qabul qilindi (pending yoki admin darhol tasdiqlagan)
   *  - `confirmed` — admin pending chekni tasdiqladi
   *  - `rejected`  — admin chekni rad etdi (avval "qabul qilindi" ketgan bo'lsa
   *                  ota-ona noto'g'ri ma'lumot bilan qolmasligi uchun)
   */
  async notifyReceipt(
    receiptId: number,
    kind: 'received' | 'confirmed' | 'rejected',
  ): Promise<void> {
    try {
      const receipt = await this.receiptRepo.findOne({
        where: { id: receiptId },
      });
      if (!receipt) return;

      const payment = await this.paymentRepo.findOne({
        where: { id: receipt.paymentId },
      });
      if (!payment) return;

      const student = await this.studentRepo.findOne({
        where: { id: payment.studentId },
        relations: ['center'],
      });
      const organizationId = student?.center?.organizationId;
      if (!student || !organizationId) return;

      if (!this.botService.isReady(organizationId)) return;

      const settings = await this.settingsService.getOrCreate(organizationId);
      if (!settings?.isEnabled) return;
      if (kind === 'received' && !settings.notifyPaymentReceived) return;
      if (kind === 'confirmed' && !settings.notifyPaymentConfirmed) return;
      // Rad etish xabari faqat "qabul qilindi" xabari ketgan bo'lsa ma'noli:
      // aks holda ota-ona umuman bilmagan to'lov haqida xabar olardi.
      if (kind === 'rejected' && !settings.notifyPaymentReceived) return;

      const group = payment.groupId
        ? await this.groupRepo.findOne({ where: { id: payment.groupId } })
        : null;

      const studentName = `${student.firstName} ${student.lastName}`.trim();
      const centerName = student.center?.name ?? '';
      const amount = Number(receipt.amount ?? 0);

      if (kind === 'rejected') {
        await this.sendToStudent(organizationId, student.id, (lang) =>
          paymentRejectedMessage(lang, {
            studentName,
            centerName,
            forMonth: payment.forMonth,
            amount,
            checkNo: receipt.checkNo ?? null,
          }),
        );
        return;
      }

      const remaining = await this.computeMonthRemaining(payment);
      await this.sendToStudent(organizationId, student.id, (lang) =>
        paymentMessage(
          lang,
          {
            studentName,
            centerName,
            groupName: group?.name ?? null,
            forMonth: payment.forMonth,
            amount,
            checkNo: receipt.checkNo ?? null,
            remaining,
            pending: receipt.status === PaymentReceiptStatus.PENDING,
          },
          kind,
        ),
      );
    } catch (e) {
      this.logger.warn(`Telegram to‘lov xabari yuborilmadi: ${errMsg(e)}`);
    }
  }

  // ── Davomat ───────────────────────────────────────────────────

  /**
   * Darsga kelmagan / kechikkan o'quvchilar bo'yicha xabar.
   * Davomat yuborilgandan keyin chaqiriladi; sozlamada o'chiq bo'lsa jim o'tadi.
   */
  async notifyAbsences(
    groupId: number,
    lessonDate: string,
    items: { studentId: number; late: boolean }[],
  ): Promise<void> {
    try {
      if (!items.length) return;

      const group = await this.groupRepo.findOne({ where: { id: groupId } });
      const students = await this.studentRepo.find({
        where: items.map((i) => ({ id: i.studentId })),
        relations: ['center'],
      });
      const byId = new Map(students.map((s) => [s.id, s]));
      const settingsCache = new Map<number, boolean>();

      for (const item of items) {
        const student = byId.get(item.studentId);
        const organizationId = student?.center?.organizationId;
        if (!student || !organizationId) continue;

        if (!settingsCache.has(organizationId)) {
          const settings =
            await this.settingsService.getOrCreate(organizationId);
          settingsCache.set(
            organizationId,
            this.botService.isReady(organizationId) &&
              !!settings?.isEnabled &&
              !!settings?.notifyAbsence,
          );
        }
        if (!settingsCache.get(organizationId)) continue;

        const studentName = `${student.firstName} ${student.lastName}`.trim();
        await this.sendToStudent(organizationId, student.id, (lang) =>
          absenceMessage(lang, {
            studentName,
            centerName: student.center?.name ?? '',
            groupName: group?.name ?? null,
            lessonDate,
            late: item.late,
          }),
        );
      }
    } catch (e) {
      this.logger.warn(`Telegram davomat xabari yuborilmadi: ${errMsg(e)}`);
    }
  }

  // ── Qarz eslatmasi ────────────────────────────────────────────

  /**
   * Har kuni 09:00 da (Toshkent) ishlaydi va sozlamasida shu kun belgilangan
   * tashkilotlarga eslatma yuboradi. Kun tashkilot bo'yicha sozlanadi
   * (`debtReminderDay`, default 10 — to'lov muddati).
   */
  @Cron('0 9 * * *', { timeZone: 'Asia/Tashkent' })
  async sendDebtReminders(): Promise<void> {
    try {
      const today = new Date().getDate();
      const all = await this.settingsService.findAll();
      for (const settings of all) {
        if (!this.botService.isReady(settings.organizationId)) continue;
        if (!settings.isEnabled || !settings.notifyDebt) continue;
        if (Number(settings.debtReminderDay) !== today) continue;
        await this.sendDebtRemindersForOrganization(settings.organizationId);
      }
    } catch (e) {
      this.logger.warn(`Telegram qarz eslatmasi yuborilmadi: ${errMsg(e)}`);
    }
  }

  /** Bitta tashkilot bo'yicha qarzdorlarga eslatma (cron va qo'lda sinov uchun) */
  async sendDebtRemindersForOrganization(
    organizationId: number,
  ): Promise<{ students: number }> {
    const rows: {
      studentId: number;
      firstName: string;
      lastName: string;
      centerName: string;
      groupName: string | null;
      forMonth: string;
      debt: string;
    }[] = await this.paymentRepo.query(
      `
      SELECT p."studentId",
             s."firstName",
             s."lastName",
             c."name"  AS "centerName",
             g."name"  AS "groupName",
             TO_CHAR(p."forMonth", 'YYYY-MM-DD') AS "forMonth",
             (p."amountDue" - p."amountPaid")    AS "debt"
      FROM "payments" p
      JOIN "students" s ON s."id" = p."studentId"
      JOIN "centers"  c ON c."id" = s."centerId"
      LEFT JOIN "groups" g ON g."id" = p."groupId"
      WHERE c."organizationId" = $1
        AND p."status" <> 'paid'
        AND (p."amountDue" - p."amountPaid") > 0
        AND p."forMonth" <= DATE_TRUNC('month', CURRENT_DATE)
        AND EXISTS (
          SELECT 1 FROM "telegram_parent_links" l
          WHERE l."studentId" = p."studentId" AND l."isActive" = true
        )
      ORDER BY p."studentId", p."forMonth"
      `,
      [organizationId],
    );

    const byStudent = new Map<
      number,
      {
        studentName: string;
        centerName: string;
        total: number;
        rows: { groupName: string | null; forMonth: string; amount: number }[];
      }
    >();

    for (const row of rows) {
      const amount = Number(row.debt ?? 0);
      const entry = byStudent.get(row.studentId) ?? {
        studentName: `${row.firstName} ${row.lastName}`.trim(),
        centerName: row.centerName ?? '',
        total: 0,
        rows: [],
      };
      entry.total += amount;
      entry.rows.push({
        groupName: row.groupName,
        forMonth: row.forMonth,
        amount,
      });
      byStudent.set(row.studentId, entry);
    }

    for (const [studentId, data] of byStudent) {
      await this.sendToStudent(organizationId, studentId, (lang) =>
        debtMessage(lang, data),
      );
    }

    return { students: byStudent.size };
  }

  // ── Ichki ─────────────────────────────────────────────────────

  /**
   * O'quvchiga ulangan barcha faol chatlarga xabar yuboradi.
   * Matn har bir chat uchun alohida tilda quriladi.
   */
  private async sendToStudent(
    organizationId: number,
    studentId: number,
    build: (lang: BotLang) => string,
  ): Promise<void> {
    const links = await this.linksService.findActiveLinksByStudent(studentId);
    for (const link of links) {
      const text = build(pickLang(link.languageCode));
      const result = await this.botService.sendMessage(
        organizationId,
        link.chatId,
        text,
      );
      if (result.sent) {
        await this.linksService.markNotified(link.id);
      } else if (result.blocked) {
        // Botni bloklagan chatga qayta urinish — bekorga so'rov. O'chirib
        // qo'yamiz; ota-ona QR ni qayta skaner qilsa ulanish tiklanadi.
        await this.linksService.markBlocked(link.id);
      }
    }
  }

  /**
   * Shu oy uchun qolgan qarz: tasdiqlangan pul + tasdiq kutayotgan cheklar
   * `amountDue` dan ayriladi (pending pul allaqachon ota-onadan olingan).
   */
  private async computeMonthRemaining(payment: Payment): Promise<number> {
    const pending = await this.receiptRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.amount), 0)', 'sum')
      .where('r.paymentId = :paymentId', { paymentId: payment.id })
      .andWhere('r.status = :status', { status: PaymentReceiptStatus.PENDING })
      .getRawOne<{ sum: string }>();

    const remaining =
      Number(payment.amountDue ?? 0) -
      Number(payment.amountPaid ?? 0) -
      Number(pending?.sum ?? 0);
    return Math.max(0, Math.round(remaining * 100) / 100);
  }
}

const errMsg = (e: unknown): string => (e as any)?.message ?? String(e);
