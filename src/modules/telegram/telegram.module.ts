import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { PaymentReceipt } from '@/modules/payments/entities/payment-receipt.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { TelegramBotSettings } from './entities/telegram-bot-settings.entity';
import { TelegramLinkToken } from './entities/telegram-link-token.entity';
import { TelegramParentLink } from './entities/telegram-parent-link.entity';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramChatService } from './telegram-chat.service';
import { TelegramLinksService } from './telegram-links.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { TelegramSettingsService } from './telegram-settings.service';
import { TelegramController } from './telegram.controller';

/**
 * Ota-onalar uchun Telegram bot.
 *
 * Modul **hech kimga bog'lanmaydi** — faqat repozitoriylarni o'qiydi. Shu
 * sabab uni `PaymentsModule` va `AttendanceModule` bemalol import qila oladi
 * (halqa hosil bo'lmaydi). Aksincha bog'lanish yo'q: bot hech qachon to'lov
 * yoki davomat servisini chaqirmaydi.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TelegramBotSettings,
      TelegramLinkToken,
      TelegramParentLink,
      Student,
      Group,
      Payment,
      PaymentReceipt,
    ]),
  ],
  controllers: [TelegramController],
  providers: [
    TelegramBotService,
    TelegramChatService,
    TelegramLinksService,
    TelegramNotifierService,
    TelegramSettingsService,
  ],
  exports: [TelegramNotifierService, TelegramBotService],
})
export class TelegramModule {}
