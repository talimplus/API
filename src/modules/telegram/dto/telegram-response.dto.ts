import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TelegramParentDto {
  @ApiProperty() id: number;
  @ApiPropertyOptional() firstName?: string | null;
  @ApiPropertyOptional() lastName?: string | null;
  @ApiPropertyOptional() username?: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() linkedAt: Date;
  @ApiPropertyOptional() unlinkedAt?: Date | null;
  @ApiPropertyOptional() blockedAt?: Date | null;
  @ApiPropertyOptional() lastNotifiedAt?: Date | null;
}

export class TelegramStudentLinkDto {
  @ApiProperty() studentId: number;

  @ApiPropertyOptional({
    description: 'Bot username (@ siz). Bot sozlanmagan bo‘lsa null',
  })
  botUsername?: string | null;

  @ApiProperty({ description: 'TELEGRAM_BOT_TOKEN sozlanganmi' })
  botConfigured: boolean;

  @ApiPropertyOptional({
    description: 'QR ichidagi havola: https://t.me/<bot>?start=<token>',
  })
  deepLink?: string | null;

  @ApiPropertyOptional({ description: 'QR kod — PNG data URL' })
  qrDataUrl?: string | null;

  @ApiProperty({ type: [TelegramParentDto] })
  parents: TelegramParentDto[];
}

export class TelegramSettingsDto {
  @ApiProperty() id: number;
  @ApiProperty() organizationId: number;
  @ApiProperty() isEnabled: boolean;
  @ApiProperty() notifyPaymentReceived: boolean;
  @ApiProperty() notifyPaymentConfirmed: boolean;
  @ApiProperty() notifyAbsence: boolean;
  @ApiProperty() notifyDebt: boolean;
  @ApiProperty() debtReminderDay: number;

  @ApiProperty({ description: 'Tashkilotning bot tokeni saqlanganmi' })
  botConfigured: boolean;

  @ApiProperty({ description: 'Bot hozir ulangan holatdami (polling)' })
  botConnected: boolean;

  @ApiPropertyOptional({ description: 'getMe() dan olingan username' })
  botUsername?: string | null;

  @ApiPropertyOptional({
    description: 'Niqoblangan token (to‘liq qiymat hech qachon qaytarilmaydi)',
  })
  botTokenMasked?: string | null;

  @ApiPropertyOptional() botTokenUpdatedAt?: Date | null;
}
