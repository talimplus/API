import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateTelegramSettingsDto {
  @ApiPropertyOptional({
    description: 'Umumiy kalit — o‘chirilsa hech qanday xabar yuborilmaydi',
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Pul qabul qilinganda (chek yaratilganda) xabar yuborish',
  })
  @IsOptional()
  @IsBoolean()
  notifyPaymentReceived?: boolean;

  @ApiPropertyOptional({
    description: 'Admin chekni tasdiqlaganda xabar yuborish',
  })
  @IsOptional()
  @IsBoolean()
  notifyPaymentConfirmed?: boolean;

  @ApiPropertyOptional({
    description: 'O‘quvchi darsga kelmaganda yoki kechikkanda xabar yuborish',
  })
  @IsOptional()
  @IsBoolean()
  notifyAbsence?: boolean;

  @ApiPropertyOptional({ description: 'Oylik qarz eslatmasini yuborish' })
  @IsOptional()
  @IsBoolean()
  notifyDebt?: boolean;

  @ApiPropertyOptional({
    description: 'Qarz eslatmasi yuboriladigan kun (1–28)',
    minimum: 1,
    maximum: 28,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  debtReminderDay?: number;
}
