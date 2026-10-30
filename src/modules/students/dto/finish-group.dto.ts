import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * `POST /groups/:id/finish` — guruhni yakunlash: tugash sanasi, belgilangan
 * o'quvchilar boshqa (yoki shu yerda yaratilgan) guruhga o'tadi, qolganlari
 * "tugallangan" bo'ladi.
 */
export class FinishGroupDto {
  @ApiProperty({
    example: '2026-10-30',
    description:
      'Guruhning OXIRGI dars kuni (inclusive). Bugundan keyin, guruh ' +
      "boshlanishidan va tashkilot ochilishidan oldin bo'lolmaydi; undan keyingi " +
      "kunlarga davomat yozilgan bo'lsa — 422.",
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "endDate YYYY-MM-DD formatida bo'lishi kerak",
  })
  endDate: string;

  @ApiPropertyOptional({
    example: 12,
    description:
      "O'quvchilar o'tadigan guruh (shu filialdan, tugamagan). `new` bo'lsa — " +
      'avtomatik boshlanadi. `studentIds` bilan birga beriladi.',
  })
  @IsOptional()
  @IsInt()
  targetGroupId?: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [3, 5],
    description:
      "Ko'chiriladigan o'quvchilar (hozir shu guruhda). Ko'chirish sanasi — " +
      'endDate dan keyingi kun. Qolganlari guruh bilan tugaydi.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  studentIds?: number[];

  @ApiPropertyOptional({ example: 'Kurs tugadi, keyingi bosqich' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
