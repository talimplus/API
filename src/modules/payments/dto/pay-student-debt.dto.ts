import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { PaymentMethod } from '@/modules/payments/entities/payment-receipt.entity';

export class PayStudentDebtDto {
  @ApiPropertyOptional({
    example: 600000,
    description:
      "To'lov summasi. Bo'sh qoldirilsa, o'quvchining jami qarzi to'liq to'lanadi. " +
      "Summa eng eski oydan boshlab taqsimlanadi (oldest-first).",
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: 'Naqd, 2 oylik qarz' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, example: PaymentMethod.CASH })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    example: '2026-09-06',
    description:
      "To'lov amalga oshirilgan sana (asosan KARTA uchun — reception qo'lda " +
      'kiritadi). YYYY-MM-DD formatida.',
  })
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
