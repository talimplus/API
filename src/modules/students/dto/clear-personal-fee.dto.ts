import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/** Shaxsiy narxni olib tashlash — qaysi oydan guruh narxi ishlatiladi. */
export class ClearPersonalFeeDto {
  @ApiProperty({
    example: '2026-09-01',
    description:
      'Shu oydan (YYYY-MM-01; kun berilsa oyning 1-sanasiga tushadi) boshlab guruh narxi. ' +
      "Joriy oydan keyin va 24 oydan uzoq bo'lolmaydi.",
  })
  @IsDateString()
  fromMonth: string;
}

export class PreviewClearPersonalFeeDto {
  @ApiProperty({
    required: false,
    example: '2026-09-01',
    description: "Berilmasa — o'quvchi faollashgan oy (`defaultFromMonth`).",
  })
  @IsOptional()
  @IsDateString()
  fromMonth?: string;
}
