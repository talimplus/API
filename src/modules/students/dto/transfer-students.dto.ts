import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * O'quvchilarni bir guruhdan boshqasiga ko'chirish.
 *
 * Uchta hayotiy holat shu bitta amal bilan qoplanadi:
 *  1. guruhda odam kam qolgani uchun uni yopib, o'quvchilarni boshqasiga
 *     o'tkazish (`closeSourceGroup: true`);
 *  2. o'quvchi bir necha oy o'qib, boshqa guruhga o'tishi (oy o'rtasida);
 *  3. kurs tugab (masalan 2 oylik kompyuter savodxonligi), keyingi bosqich
 *     guruhiga o'tish — bunda `transferDate` odatda yangi guruh boshlanish
 *     sanasi bo'ladi.
 */
/**
 * Ko'chirishdan OLDIN ko'rsatiladigan ma'lumot uchun.
 *
 * Maqsad guruh bu yerda **kerak emas**: qarz ham, ortiqcha to'lov ham faqat
 * manba guruhdan o'qiladi. Modal ochilishi bilan (foydalanuvchi hali guruh
 * tanlamagan paytda) chaqirilishi uchun ham shunday.
 */
export class TransferPreviewDto {
  @ApiProperty({
    description: "Ko'chiriladigan o'quvchilar",
    type: [Number],
    example: [12, 15, 21],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  studentIds: number[];

  @ApiProperty({ description: 'Qaysi guruhdan', example: 3 })
  @IsInt()
  fromGroupId: number;
}

export class TransferStudentsDto {
  @ApiProperty({
    description: "Ko'chiriladigan o'quvchilar",
    type: [Number],
    example: [12, 15, 21],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  studentIds: number[];

  @ApiProperty({ description: 'Qaysi guruhdan', example: 3 })
  @IsInt()
  fromGroupId: number;

  @ApiProperty({ description: 'Qaysi guruhga', example: 7 })
  @IsInt()
  toGroupId: number;

  @ApiPropertyOptional({
    description:
      "Ko'chirish sanasi (YYYY-MM-DD). Eski guruhda shu kundan boshlab " +
      "darslar to'lovga kirmaydi, yangi guruhda shu kundan hisoblanadi. " +
      'Berilmasa — bugungi sana.',
    example: '2026-09-21',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "transferDate YYYY-MM-DD formatida bo'lishi kerak",
  })
  transferDate?: string;

  @ApiPropertyOptional({ description: 'Izoh (sabab)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    description:
      "Barcha o'quvchilar ko'chirilgandan keyin eski guruhni yopish " +
      '(status -> finished, tugash sanasi shu kunga tortiladi)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  closeSourceGroup?: boolean;
}
