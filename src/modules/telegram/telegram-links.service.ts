import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { Student } from '@/modules/students/entities/students.entity';
import { TelegramLinkToken } from './entities/telegram-link-token.entity';
import { TelegramParentLink } from './entities/telegram-parent-link.entity';
import { TelegramBotService } from './telegram-bot.service';

export interface CurrentUserLike {
  userId: number;
  organizationId: number;
}

/**
 * QR kod, ulanish tokenlari va ulangan ota-onalar ro'yxati.
 *
 * QR ichida o'quvchi `id` si emas, tasodifiy token turadi — shu sabab QR ni
 * ko'chirib olgan begona odam boshqa o'quvchiga ulanolmaydi.
 */
@Injectable()
export class TelegramLinksService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(TelegramLinkToken)
    private readonly tokenRepo: Repository<TelegramLinkToken>,
    @InjectRepository(TelegramParentLink)
    private readonly linkRepo: Repository<TelegramParentLink>,
    private readonly botService: TelegramBotService,
  ) {}

  // ── Kabinet tomoni ────────────────────────────────────────────

  /** O'quvchining QR kodi + ulangan ota-onalar ro'yxati */
  async getStudentLink(studentId: number, user: CurrentUserLike) {
    const student = await this.getStudentInOrg(studentId, user.organizationId);
    const token = await this.ensureToken(student.id);
    return this.buildLinkResponse(student, token);
  }

  /**
   * Tokenni yangilaydi — eski QR shu zahoti ishlamay qoladi.
   * Allaqachon ulangan ota-onalar uzilmaydi (ular endi tokenga bog'liq emas).
   */
  async regenerateToken(studentId: number, user: CurrentUserLike) {
    const student = await this.getStudentInOrg(studentId, user.organizationId);
    let row = await this.tokenRepo.findOne({
      where: { studentId: student.id },
    });
    if (!row) {
      row = await this.ensureToken(student.id);
    }
    row.token = generateToken();
    row.rotatedById = user.userId;
    row.rotatedAt = new Date();
    const saved = await this.tokenRepo.save(row);
    return this.buildLinkResponse(student, saved);
  }

  /** Ota-onaning ulanishini uzadi (qator o'chmaydi — tarix qoladi) */
  async unlinkParent(linkId: number, user: CurrentUserLike) {
    const link = await this.linkRepo.findOne({ where: { id: linkId } });
    if (!link) throw new NotFoundException('Ulanish topilmadi');
    // Tashkilot chegarasi: begona tashkilotning ulanishini uzib bo'lmaydi.
    await this.getStudentInOrg(link.studentId, user.organizationId);

    if (link.isActive) {
      link.isActive = false;
      link.unlinkedAt = new Date();
      await this.linkRepo.save(link);
    }
    return { success: true };
  }

  // ── Bot tomoni ────────────────────────────────────────────────

  /**
   * `/start <token>` — tokendan o'quvchini topadi.
   * Tashkilot chegarasini chaqiruvchi tekshiradi: A markazning QR kodi
   * B markazning botiga ulanmasligi kerak.
   */
  async findStudentByToken(token: string): Promise<Student | null> {
    const row = await this.tokenRepo.findOne({ where: { token } });
    if (!row) return null;
    return this.studentRepo.findOne({
      where: { id: row.studentId },
      relations: ['center'],
    });
  }

  /**
   * Chatni o'quvchiga ulaydi. Qayta skaner qilinsa yangi qator yaratilmaydi —
   * mavjudi qayta faollashadi (`alreadyLinked` bilan farqlanadi).
   */
  async linkChat(args: {
    studentId: number;
    organizationId: number;
    chatId: string;
    telegramUserId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    languageCode?: string | null;
  }): Promise<{ link: TelegramParentLink; alreadyLinked: boolean }> {
    const existing = await this.linkRepo.findOne({
      where: { studentId: args.studentId, chatId: args.chatId },
    });

    if (existing) {
      const alreadyLinked = existing.isActive && !existing.blockedAt;
      existing.isActive = true;
      existing.unlinkedAt = null;
      existing.blockedAt = null;
      existing.organizationId = args.organizationId;
      existing.firstName = args.firstName ?? existing.firstName;
      existing.lastName = args.lastName ?? existing.lastName;
      existing.username = args.username ?? existing.username;
      existing.languageCode = args.languageCode ?? existing.languageCode;
      const saved = await this.linkRepo.save(existing);
      return { link: saved, alreadyLinked };
    }

    const created = this.linkRepo.create({
      studentId: args.studentId,
      organizationId: args.organizationId,
      chatId: args.chatId,
      telegramUserId: args.telegramUserId ?? null,
      firstName: args.firstName ?? null,
      lastName: args.lastName ?? null,
      username: args.username ?? null,
      languageCode: args.languageCode ?? null,
      isActive: true,
    });
    const saved = await this.linkRepo.save(created);
    return { link: saved, alreadyLinked: false };
  }

  /**
   * Shu chatga ulangan faol o'quvchilar (`/status`, `/stop` uchun).
   * Faqat **shu tashkilot** ichida: bitta odam ikki markazning botiga
   * ulangan bo'lishi mumkin, har bot faqat o'zinikini ko'rsatadi.
   */
  findActiveLinksByChat(organizationId: number, chatId: string) {
    return this.linkRepo.find({
      where: { organizationId, chatId, isActive: true },
      relations: ['student'],
      order: { id: 'ASC' },
    });
  }

  /** Xabar yuborish uchun: o'quvchining faol chatlari */
  findActiveLinksByStudent(studentId: number) {
    return this.linkRepo.find({
      where: { studentId, isActive: true },
      order: { id: 'ASC' },
    });
  }

  async deactivateByChat(
    organizationId: number,
    chatId: string,
  ): Promise<number> {
    const links = await this.linkRepo.find({
      where: { organizationId, chatId, isActive: true },
    });
    if (!links.length) return 0;
    const now = new Date();
    for (const link of links) {
      link.isActive = false;
      link.unlinkedAt = now;
    }
    await this.linkRepo.save(links);
    return links.length;
  }

  /** Bot bloklangan / chat o'chirilgan — qayta urinmaymiz */
  async markBlocked(linkId: number) {
    await this.linkRepo.update(linkId, {
      isActive: false,
      blockedAt: new Date(),
    });
  }

  async markNotified(linkId: number) {
    await this.linkRepo.update(linkId, { lastNotifiedAt: new Date() });
  }

  // ── Ichki yordamchilar ────────────────────────────────────────

  private async getStudentInOrg(studentId: number, organizationId: number) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId },
      relations: ['center'],
    });
    if (!student || student.center?.organizationId !== organizationId) {
      throw new NotFoundException('O‘quvchi topilmadi');
    }
    return student;
  }

  private async ensureToken(studentId: number): Promise<TelegramLinkToken> {
    const existing = await this.tokenRepo.findOne({ where: { studentId } });
    if (existing) return existing;
    // Poyga holati (ikki so'rov bir vaqtda): unique constraint ishlaydi,
    // shuning uchun xatolikda mavjudini qayta o'qiymiz.
    try {
      return await this.tokenRepo.save(
        this.tokenRepo.create({ studentId, token: generateToken() }),
      );
    } catch {
      const again = await this.tokenRepo.findOne({ where: { studentId } });
      if (again) return again;
      throw new NotFoundException('QR kod yaratilmadi');
    }
  }

  private async buildLinkResponse(student: Student, token: TelegramLinkToken) {
    const organizationId = student.center?.organizationId ?? 0;
    const botUsername = this.botService.getBotUsername(organizationId);
    const deepLink = botUsername
      ? `https://t.me/${botUsername}?start=${token.token}`
      : null;
    const qrDataUrl = deepLink
      ? await QRCode.toDataURL(deepLink, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 320,
        })
      : null;

    const links = await this.linkRepo.find({
      where: { studentId: student.id },
      order: { isActive: 'DESC', id: 'ASC' },
    });

    return {
      studentId: student.id,
      botUsername,
      botConfigured: !!botUsername,
      deepLink,
      qrDataUrl,
      parents: links.map((l) => ({
        id: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        username: l.username,
        isActive: l.isActive,
        linkedAt: l.linkedAt,
        unlinkedAt: l.unlinkedAt,
        blockedAt: l.blockedAt,
        lastNotifiedAt: l.lastNotifiedAt,
      })),
    };
  }
}

/** 22 belgili URL-xavfsiz token (Telegram `start` payload cheklovi — 64) */
const generateToken = (): string => randomBytes(16).toString('base64url');
