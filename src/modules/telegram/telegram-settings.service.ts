import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { TelegramBotSettings } from './entities/telegram-bot-settings.entity';
import { UpdateTelegramSettingsDto } from './dto/update-telegram-settings.dto';
import { TelegramBotService } from './telegram-bot.service';

/**
 * Tashkilot darajasidagi bot sozlamalari.
 *
 * Qator yo'q bo'lsa ham kod ishlayveradi — o'qishda default bilan yaratiladi.
 * Default: faqat **to'lov qabul qilinganda** xabar ketadi; davomat va qarz
 * eslatmasi o'chiq (ularni markaz o'zi ataylab yoqadi).
 *
 * Bot tokeni ham shu yerda, lekin u **hech qachon ochiq qaytarilmaydi** —
 * frontga faqat "o'rnatilganmi" (`botConfigured`) va niqoblangan ko'rinishi
 * (`botTokenMasked`) boradi.
 */
@Injectable()
export class TelegramSettingsService {
  constructor(
    @InjectRepository(TelegramBotSettings)
    private readonly repo: Repository<TelegramBotSettings>,
    private readonly botService: TelegramBotService,
  ) {}

  async getOrCreate(organizationId: number): Promise<TelegramBotSettings> {
    const existing = await this.repo.findOne({ where: { organizationId } });
    if (existing) return existing;
    try {
      return await this.repo.save(this.repo.create({ organizationId }));
    } catch {
      // Poyga holati — unique constraint tutdi, mavjudini qaytaramiz.
      return this.repo.findOne({ where: { organizationId } });
    }
  }

  /** Sozlamalar + botning ulanish holati (sahifa shuni ko'rsatadi) */
  async getForOrganization(organizationId: number) {
    const settings = await this.getOrCreate(organizationId);
    return this.toResponse(settings);
  }

  async update(organizationId: number, dto: UpdateTelegramSettingsDto) {
    const settings = await this.getOrCreate(organizationId);
    Object.assign(settings, dto);
    await this.repo.save(settings);
    return this.getForOrganization(organizationId);
  }

  /**
   * Bot tokenini o'rnatadi/almashtiradi.
   *
   * Token avval Telegram'da **tekshiriladi** (`getMe`) — shu bilan username
   * ham avtomatik olinadi, ya'ni uni qo'lda kiritish shart emas. Keyin bot
   * darhol ishga tushadi: qayta deploy kutilmaydi.
   */
  async setBotToken(organizationId: number, rawToken: string) {
    const token = rawToken.trim();
    if (!token) {
      throw new BadRequestException("Bot tokeni bo'sh bo'lishi mumkin emas");
    }

    // Bitta token ikkita tashkilotda ishlatilsa Telegram 409 beradi va
    // ikkalasining ham boti tutilib qoladi — oldindan to'sib qo'yamiz.
    const taken = await this.repo.findOne({
      where: { botToken: token, organizationId: Not(organizationId) },
    });
    if (taken) {
      throw new BadRequestException(
        'Bu token boshqa tashkilotga biriktirilgan. Har bir markaz uchun alohida bot oching.',
      );
    }

    const { username } = await this.botService.verifyToken(token);

    const settings = await this.getOrCreate(organizationId);
    settings.botToken = token;
    settings.botUsername = username;
    settings.botTokenUpdatedAt = new Date();
    await this.repo.save(settings);

    await this.botService.applyToken(organizationId, token, username);
    return this.getForOrganization(organizationId);
  }

  /** Botni uzadi. Ulangan ota-onalar o'chmaydi — token qaytarilsa tiklanadi. */
  async removeBotToken(organizationId: number) {
    const settings = await this.getOrCreate(organizationId);
    settings.botToken = null;
    settings.botUsername = null;
    settings.botTokenUpdatedAt = new Date();
    await this.repo.save(settings);

    await this.botService.applyToken(organizationId, null, null);
    return this.getForOrganization(organizationId);
  }

  /** Barcha tashkilotlarning sozlamasi — qarz eslatmasi cron'i uchun */
  findAll() {
    return this.repo.find();
  }

  private toResponse(settings: TelegramBotSettings) {
    const { botToken, ...rest } = settings;
    return {
      ...rest,
      /** Token saqlanganmi (qiymati ochilmaydi) */
      botConfigured: !!botToken,
      /** Bot hozir polling qilayaptimi */
      botConnected: this.botService.isReady(settings.organizationId),
      botUsername:
        this.botService.getBotUsername(settings.organizationId) ??
        settings.botUsername ??
        null,
      botTokenMasked: maskToken(botToken),
    };
  }
}

/** `1234567890:AAE...xyz` → `1234567890:AA…xyz` */
const maskToken = (token?: string | null): string | null => {
  if (!token) return null;
  const [id, secret] = token.split(':');
  if (!secret) return '••••';
  return `${id}:${secret.slice(0, 2)}…${secret.slice(-3)}`;
};
