import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class ConfirmReceiptsDto {
  @ApiPropertyOptional({
    type: [Number],
    example: [12, 13, 14],
    description:
      "Tasdiqlanadigan receipt id'lari (frontendda checkbox bilan belgilanganlar). " +
      "Berilsa `all` e'tiborga olinmaydi.",
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  receiptIds?: number[];

  @ApiPropertyOptional({
    example: true,
    description:
      '"Barchasini oldim" tugmasi uchun. `receiptIds` berilmaganda MAJBURIY ' +
      '(tasodifan hammasini tasdiqlab yubormaslik uchun). Filterga (centerId, ' +
      'dateFrom, dateTo) mos keladigan BARCHA pending receiptlar tasdiqlanadi.',
  })
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @ApiPropertyOptional({
    example: 2,
    description:
      "Faqat `all: true` uchun. Admin bo'lmaganlar o'z markaziga bog'lanadi.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  centerId?: number;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description:
      "Faqat `all: true` uchun: qabul qilingan sana (receivedAt) oralig'i boshi. " +
      'YYYY-MM-DD.',
  })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-09-20',
    description:
      "Faqat `all: true` uchun: qabul qilingan sana (receivedAt) oralig'i oxiri " +
      '(shu kun ham kiradi). YYYY-MM-DD.',
  })
  @IsOptional()
  @IsString()
  dateTo?: string;
}
