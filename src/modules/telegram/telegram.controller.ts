import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { TelegramLinksService } from './telegram-links.service';
import { TelegramSettingsService } from './telegram-settings.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { UpdateTelegramSettingsDto } from './dto/update-telegram-settings.dto';
import { SetBotTokenDto } from './dto/set-bot-token.dto';
import {
  TelegramSettingsDto,
  TelegramStudentLinkDto,
} from './dto/telegram-response.dto';

@ApiTags('Telegram (ota-onalar boti)')
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly linksService: TelegramLinksService,
    private readonly settingsService: TelegramSettingsService,
    private readonly notifier: TelegramNotifierService,
  ) {}

  // ── O'quvchi sahifasidagi QR ──────────────────────────────────

  @Get('students/:studentId/link')
  @RequirePermissions('students.view')
  @ApiOperation({
    summary: 'O‘quvchining QR kodi va unga ulangan ota-onalar',
    description:
      'QR ichida o‘quvchi id si emas, maxfiy token turadi. Ota-ona QR ni ' +
      'skaner qilganda bot `/start <token>` oladi va chat o‘quvchiga bog‘lanadi.',
  })
  @ApiResponse({ type: TelegramStudentLinkDto })
  getStudentLink(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Req() req: any,
  ) {
    return this.linksService.getStudentLink(studentId, req.user);
  }

  @Post('students/:studentId/link/regenerate')
  @RequirePermissions('students.update')
  @ApiOperation({
    summary: 'QR kodni yangilash',
    description:
      'Eski QR shu zahoti ishlamay qoladi (masalan rasm begonaga tushgan ' +
      'bo‘lsa). Allaqachon ulangan ota-onalar uzilmaydi.',
  })
  @ApiResponse({ type: TelegramStudentLinkDto })
  regenerate(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Req() req: any,
  ) {
    return this.linksService.regenerateToken(studentId, req.user);
  }

  @Delete('parents/:linkId')
  @RequirePermissions('students.update')
  @ApiOperation({
    summary: 'Ota-onaning ulanishini uzish',
    description: 'Yozuv o‘chmaydi — tarix uchun nofaol holatga o‘tadi.',
  })
  unlinkParent(@Param('linkId', ParseIntPipe) linkId: number, @Req() req: any) {
    return this.linksService.unlinkParent(linkId, req.user);
  }

  // ── Bot tokeni (har tashkilot o'z boti) ───────────────────────

  @Put('bot-token')
  @RequirePermissions('telegram.settings')
  @ApiOperation({
    summary: 'Tashkilotning bot tokenini o‘rnatish',
    description:
      'Token avval Telegram’da tekshiriladi (getMe) — username shundan ' +
      'avtomatik olinadi, qo‘lda kiritilmaydi. Muvaffaqiyatli bo‘lsa bot ' +
      'darhol ishga tushadi, qayta deploy kerak emas.',
  })
  @ApiResponse({ type: TelegramSettingsDto })
  setBotToken(@Body() dto: SetBotTokenDto, @Req() req: any) {
    return this.settingsService.setBotToken(
      req.user.organizationId,
      dto.botToken,
    );
  }

  @Delete('bot-token')
  @RequirePermissions('telegram.settings')
  @ApiOperation({
    summary: 'Botni uzish',
    description:
      'Token o‘chiriladi va polling to‘xtaydi. Ulangan ota-onalar ' +
      'o‘chmaydi — token qaytarilsa xabarlar davom etadi.',
  })
  @ApiResponse({ type: TelegramSettingsDto })
  removeBotToken(@Req() req: any) {
    return this.settingsService.removeBotToken(req.user.organizationId);
  }

  // ── Bot sozlamalari ───────────────────────────────────────────

  @Get('settings')
  @RequirePermissions('telegram.settings')
  @ApiOperation({
    summary: 'Bot sozlamalari va ulanish holati',
    description:
      'Sozlama tashkilot darajasida. Default: faqat to‘lov xabari yoqilgan.',
  })
  @ApiResponse({ type: TelegramSettingsDto })
  getSettings(@Req() req: any) {
    return this.settingsService.getForOrganization(req.user.organizationId);
  }

  @Put('settings')
  @RequirePermissions('telegram.settings')
  @ApiOperation({ summary: 'Bot sozlamalarini o‘zgartirish' })
  @ApiResponse({ type: TelegramSettingsDto })
  updateSettings(@Body() dto: UpdateTelegramSettingsDto, @Req() req: any) {
    return this.settingsService.update(req.user.organizationId, dto);
  }

  @Post('debt-reminders/send-now')
  @RequirePermissions('telegram.settings')
  @ApiOperation({
    summary: 'Qarz eslatmasini hozir yuborish',
    description:
      'Cron kunini kutmasdan qo‘lda yuborish. Sozlamadagi `notifyDebt` ' +
      'tekshirilmaydi — tugma ataylab bosilgan, demak yuboriladi.',
  })
  sendDebtReminders(@Req() req: any) {
    return this.notifier.sendDebtRemindersForOrganization(
      req.user.organizationId,
    );
  }
}
