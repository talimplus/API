import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class PreviewExclusionDto {
  @ApiPropertyOptional({
    example: 2,
    description:
      "Chiqarib tashlanadigan darslar soni. excludeAmount bilan birga yuborilsa, " +
      'excludeAmount ustun turadi.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  excludeLessons?: number;

  @ApiPropertyOptional({
    example: 70000,
    description: "Chiqarib tashlanadigan summa (so'm).",
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  excludeAmount?: number;
}

export class ApplyExclusionDto extends PreviewExclusionDto {
  @ApiPropertyOptional({
    example: '2 dars sababli qoldirildi (shifokor spravkasi)',
    description:
      "Chiqarib tashlash sababi. excludeLessons yoki excludeAmount yuborilsa MAJBURIY.",
  })
  @IsOptional()
  @IsString()
  comment?: string;
}
