import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import * as TelegramBot from 'node-telegram-bot-api';
import { TelegramBotSettings } from './entities/telegram-bot-settings.entity';

/** `node-telegram-bot-api` tipi — boshqa fayllar shu alias orqali oladi */
export type TelegramMessage = TelegramBot.Message;

export type TelegramCommandHandler = (
  organizationId: number,
  msg: TelegramMessage,
  arg: string | null,
) => Promise<void> | void;

interface RunningBot {
  bot: TelegramBot;
  username: string | null;
  token: string;
}

/**
 * Bot **registri**: har bir tashkilotning o'z boti, o'z tokeni bilan.
 *
 * Loyiha SaaS bo'lgani uchun bitta umumiy bot to'g'ri kelmaydi — har bir o'quv
 * markazi ota-onaga o'z nomi bilan yozishi kerak. Token
 * `telegram_bot_settings.botToken` da saqlanadi, bu servis esa har bir token
 * uchun alohida polling instance'ini ushlab turadi.
 *
 * Biznes mantig'i bu yerda yo'q — u `TelegramChatService` (suhbat) va
 * `TelegramNotifierService` (xabarnomalar) da. Bu qatlam faqat transport.
 */
@Injectable()
export class TelegramBotService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly bots = new Map<number, RunningBot>();
  private readonly handlers = new Map<string, TelegramCommandHandler>();
  private fallbackHandler: TelegramCommandHandler | null = null;

  constructor(
    @InjectRepository(TelegramBotSettings)
    private readonly settingsRepo: Repository<TelegramBotSettings>,
  ) {}

  /** Shu tashkilotning boti hozir ishlayaptimi */
  isReady(organizationId: number): boolean {
    return this.bots.has(organizationId);
  }

  getBotUsername(organizationId: number): string | null {
    return this.bots.get(organizationId)?.username ?? null;
  }

  /**
   * `/start`, `/stop` kabi buyruqni qabul qiluvchini ro'yxatdan o'tkazadi.
   * Nom `/` siz yoziladi. Handler birinchi argumentda qaysi tashkilotning
   * boti xabarni olganini oladi.
   */
  onCommand(name: string, handler: TelegramCommandHandler) {
    this.handlers.set(name.toLowerCase(), handler);
  }

  /** Buyruq bo'lmagan oddiy matn uchun */
  onFallback(handler: TelegramCommandHandler) {
    this.fallbackHandler = handler;
  }

  async onApplicationBootstrap() {
    const configured = await this.settingsRepo.find({
      where: { botToken: Not(IsNull()) },
    });
    if (!configured.length) {
      this.logger.log(
        'Telegram: hech bir tashkilotda bot tokeni sozlanmagan — botlar ishga tushmadi',
      );
      return;
    }
    for (const settings of configured) {
      this.start(
        settings.organizationId,
        settings.botToken,
        settings.botUsername ?? null,
      );
    }
  }

  async onModuleDestroy() {
    for (const organizationId of Array.from(this.bots.keys())) {
      await this.stop(organizationId);
    }
  }

  /**
   * Tokenni tekshiradi va bot username'ini qaytaradi.
   * Polling ochilmaydi — faqat bitta `getMe()` so'rovi.
   */
  async verifyToken(token: string): Promise<{ username: string | null }> {
    const probe = new TelegramBot(token, { polling: false });
    try {
      const me = await probe.getMe();
      return { username: me.username ?? null };
    } catch (e) {
      throw new BadRequestException(
        `Telegram tokenni qabul qilmadi: ${describeError(e)}`,
      );
    }
  }

  /**
   * Tashkilotning botini yoqadi/almashtiradi. `token = null` — o'chiradi.
   * Token bundan oldin `verifyToken` bilan tekshirilgan bo'lishi kerak.
   */
  async applyToken(
    organizationId: number,
    token: string | null,
    username: string | null,
  ) {
    await this.stop(organizationId);
    if (token) this.start(organizationId, token, username);
  }

  /**
   * Xabar yuboradi. `blocked: true` — foydalanuvchi botni bloklagan yoki chat
   * o'chirilgan: chaqiruvchi ulanishni o'chirib qo'yishi kerak, aks holda har
   * safar shu xato takrorlanaveradi.
   */
  async sendMessage(
    organizationId: number,
    chatId: string,
    text: string,
  ): Promise<{ sent: boolean; blocked: boolean }> {
    const running = this.bots.get(organizationId);
    if (!running) return { sent: false, blocked: false };
    try {
      await running.bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      return { sent: true, blocked: false };
    } catch (e) {
      const code = (e as any)?.response?.body?.error_code;
      const description: string =
        (e as any)?.response?.body?.description ?? errMsg(e);
      const blocked =
        code === 403 ||
        (code === 400 && /chat not found/i.test(description)) ||
        /bot was blocked|user is deactivated/i.test(description);
      if (!blocked) {
        this.logger.warn(
          `Telegram xabari ketmadi (org ${organizationId}, chat ${chatId}): ${description}`,
        );
      }
      return { sent: false, blocked };
    }
  }

  // ── Ichki ─────────────────────────────────────────────────────

  private start(
    organizationId: number,
    token: string,
    knownUsername: string | null,
  ) {
    let bot: TelegramBot;
    try {
      bot = new TelegramBot(token, { polling: true });
    } catch (e) {
      this.logger.error(
        `Telegram botni ishga tushirib bo‘lmadi (org ${organizationId}): ${errMsg(e)}`,
      );
      return;
    }

    const running: RunningBot = { bot, username: knownUsername, token };
    this.bots.set(organizationId, running);

    // Polling xatosi (tarmoq, 409 — bir tokenda ikkita instance) ilovani
    // yiqitmasligi kerak: bot ikkinchi darajali kanal.
    bot.on('polling_error', (e) => {
      this.logger.warn(
        `Telegram polling xatosi (org ${organizationId}): ${errMsg(e)}`,
      );
    });

    bot.on('message', (msg) => {
      void this.route(organizationId, msg);
    });

    void bot
      .getMe()
      .then((me) => {
        running.username = me.username ?? knownUsername;
        this.logger.log(
          `Telegram bot ulandi: @${running.username} (org ${organizationId})`,
        );
      })
      .catch((e) => {
        this.logger.warn(
          `getMe muvaffaqiyatsiz (org ${organizationId}): ${errMsg(e)}`,
        );
      });
  }

  private async stop(organizationId: number) {
    const running = this.bots.get(organizationId);
    if (!running) return;
    this.bots.delete(organizationId);
    try {
      await running.bot.stopPolling();
    } catch {
      // yopilishda xato muhim emas
    }
  }

  private async route(organizationId: number, msg: TelegramMessage) {
    const text = msg.text?.trim();
    if (!text) return;

    const match = /^\/([a-zA-Z0-9_]+)(?:@\S+)?(?:\s+([\s\S]+))?$/.exec(text);
    try {
      if (match) {
        const handler = this.handlers.get(match[1].toLowerCase());
        if (handler) {
          await handler(organizationId, msg, match[2]?.trim() || null);
          return;
        }
      }
      if (this.fallbackHandler) {
        await this.fallbackHandler(organizationId, msg, text);
      }
    } catch (e) {
      this.logger.error(`Telegram buyrug‘ida xato: ${errMsg(e)}`);
    }
  }
}

const errMsg = (e: unknown): string => (e as any)?.message ?? String(e);

/** Telegram xatosini foydalanuvchiga ko'rsatsa bo'ladigan matnga aylantiradi */
const describeError = (e: unknown): string => {
  const description = (e as any)?.response?.body?.description;
  if (description) return String(description);
  return errMsg(e);
};
