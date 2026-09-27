import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateHolidayDto {
  @ApiProperty({
    example: '2026-03-21',
    description: 'Birinchi kun (inclusive)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fromDate YYYY-MM-DD bo‘lishi kerak',
  })
  fromDate: string;

  @ApiProperty({ example: '2026-03-23', description: 'Oxirgi kun (inclusive)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'toDate YYYY-MM-DD bo‘lishi kerak',
  })
  toDate: string;

  @ApiProperty({ example: "Navro'z" })
  @IsString()
  @IsNotEmpty({ message: 'Nomi majburiy' })
  @MaxLength(200)
  name: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      "Filial. Bo'sh — butun tashkilot. Admin bo'lmagan xodim uchun o'z filiali qo'yiladi",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  centerId?: number | null;
}

export class QueryHolidaysDto {
  @ApiProperty({ required: false, description: 'Filial (admin tanlaydi)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  centerId?: number;

  @ApiProperty({ required: false, example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;
}
