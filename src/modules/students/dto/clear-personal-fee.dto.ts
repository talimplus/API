import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional } from 'class-validator';
import { OverpaymentMode } from '@/common/enums/overpayment-mode.enum';

/** Shaxsiy narxni bitta guruhda olib tashlash — qaysi sanadan guruh narxi. */
export class ClearPersonalFeeDto {
  @ApiProperty({ example: 12, description: 'Qaysi guruhdagi shaxsiy narx' })
  @Type(() => Number)
  @IsInt()
  groupId: number;

  @ApiProperty({
    example: '2026-09-15',
    description:
      "Shu sanadan (YYYY-MM-DD, oy o'rtasi ham) boshlab guruh narxi; oldingi darslar eski narxda. " +
      "Bugundan keyin va 24 oydan uzoq bo'lolmaydi.",
  })
  @IsDateString()
  fromDate: string;

  @ApiProperty({
    enum: OverpaymentMode,
    required: false,
    default: OverpaymentMode.REFUND,
    description:
      "Guruh narxi arzon bo'lib to'langan oylarda ortiqcha pul chiqsa: `refund` — " +
      "o'quvchiga qaytariladi (`refundedAmount`), `carry` — keyingi oylarga o'tadi " +
      "(keyingi oy qatori hali yo'q bo'lsa `creditAmount` da kutadi, oy ochilganda o'tadi).",
  })
  @IsOptional()
  @IsEnum(OverpaymentMode)
  overpayment?: OverpaymentMode;
}

export class PreviewClearPersonalFeeDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  groupId: number;

  @ApiProperty({
    required: false,
    example: '2026-09-15',
    description: "Berilmasa — o'quvchi faollashgan kun (`defaultFromMonth`).",
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;
}
