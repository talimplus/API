import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { TelegramBotService, TelegramMessage } from './telegram-bot.service';
import { TelegramLinksService } from './telegram-links.service';
import { T, pickLang } from './telegram.messages';

/**
 * Ota-ona bilan suhbat: `/start <token>` (QR orqali ulanish), `/status`,
 * `/stop`, `/help`.
 *
 * Ulanish oqimi: o'quvchi sahifasidagi QR → `t.me/<bot>?start=<token>` →
 * Telegram `/start <token>` yuboradi → token bo'yicha o'quvchi topiladi va
 * chat unga bog'lanadi.
 */
@Injectable()
export class TelegramChatService implements OnModuleInit {
  private readonly logger = new Logger(TelegramChatService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly botService: TelegramBotService,
    private readonly linksService: TelegramLinksService,
  ) {}

  onModuleInit() {
    this.botService.onCommand('start', (orgId, msg, arg) =>
      this.handleStart(orgId, msg, arg),
    );
    this.botService.onCommand('status', (orgId, msg) =>
      this.handleStatus(orgId, msg),
    );
    this.botService.onCommand('stop', (orgId, msg) =>
      this.handleStop(orgId, msg),
    );
    this.botService.onCommand('help', (orgId, msg) =>
      this.handleHelp(orgId, msg),
    );
    this.botService.onFallback((orgId, msg) => this.handleUnknown(orgId, msg));
  }

  private async handleStart(
    organizationId: number,
    msg: TelegramMessage,
    arg: string | null,
  ) {
    const lang = pickLang(msg.from?.language_code);
    const chatId = String(msg.chat.id);

    if (!arg) {
      await this.botService.sendMessage(
        organizationId,
        chatId,
        T.noPayload(lang),
      );
      return;
    }

    const student = await this.linksService.findStudentByToken(arg);
    // Tashkilot chegarasi: boshqa markazning QR kodi bu botga ulanmaydi.
    // Foydalanuvchiga "yaroqsiz QR" deyiladi — boshqa markaz borligi
    // haqidagi ma'lumot oshkor qilinmaydi.
    if (!student || student.center?.organizationId !== organizationId) {
      await this.botService.sendMessage(
        organizationId,
        chatId,
        T.invalidToken(lang),
      );
      return;
    }

    const { alreadyLinked } = await this.linksService.linkChat({
      studentId: student.id,
      organizationId,
      chatId,
      telegramUserId: msg.from?.id != null ? String(msg.from.id) : null,
      firstName: msg.from?.first_name ?? null,
      lastName: msg.from?.last_name ?? null,
      username: msg.from?.username ?? null,
      languageCode: msg.from?.language_code ?? null,
    });

    const studentName = `${student.firstName} ${student.lastName}`.trim();
    await this.botService.sendMessage(
      organizationId,
      chatId,
      alreadyLinked
        ? T.alreadyLinked(lang, studentName)
        : T.linked(lang, studentName, student.center?.name ?? ''),
    );

    this.logger.log(
      `Telegram: chat ${chatId} → o'quvchi ${student.id} (${
        alreadyLinked ? 'takroriy' : 'yangi'
      })`,
    );
  }

  private async handleStatus(organizationId: number, msg: TelegramMessage) {
    const lang = pickLang(msg.from?.language_code);
    const chatId = String(msg.chat.id);

    const links = await this.linksService.findActiveLinksByChat(
      organizationId,
      chatId,
    );
    if (!links.length) {
      await this.botService.sendMessage(
        organizationId,
        chatId,
        T.statusNone(lang),
      );
      return;
    }

    const lines = [T.statusHeader(lang), ''];
    for (const link of links) {
      const name = link.student
        ? `${link.student.firstName} ${link.student.lastName}`.trim()
        : `#${link.studentId}`;
      const debt = await this.getStudentDebt(link.studentId);
      lines.push(T.statusLine(lang, name, debt));
    }
    await this.botService.sendMessage(organizationId, chatId, lines.join('\n'));
  }

  private async handleStop(organizationId: number, msg: TelegramMessage) {
    const lang = pickLang(msg.from?.language_code);
    const chatId = String(msg.chat.id);
    const count = await this.linksService.deactivateByChat(
      organizationId,
      chatId,
    );
    await this.botService.sendMessage(
      organizationId,
      chatId,
      count ? T.stopped(lang) : T.stopNone(lang),
    );
  }

  private async handleHelp(organizationId: number, msg: TelegramMessage) {
    const lang = pickLang(msg.from?.language_code);
    await this.botService.sendMessage(
      organizationId,
      String(msg.chat.id),
      T.help(lang),
    );
  }

  private async handleUnknown(organizationId: number, msg: TelegramMessage) {
    const lang = pickLang(msg.from?.language_code);
    await this.botService.sendMessage(
      organizationId,
      String(msg.chat.id),
      T.unknown(lang),
    );
  }

  /** O'quvchining barcha guruhlari bo'yicha umumiy qarzi */
  private async getStudentDebt(studentId: number): Promise<number> {
    const row = await this.paymentRepo
      .createQueryBuilder('p')
      .select(
        'COALESCE(SUM(GREATEST(p.amountDue - p.amountPaid, 0)), 0)',
        'debt',
      )
      .where('p.studentId = :studentId', { studentId })
      .andWhere('p.status != :paid', { paid: 'paid' })
      .getRawOne<{ debt: string }>();
    return Math.max(0, Number(row?.debt ?? 0));
  }
}
