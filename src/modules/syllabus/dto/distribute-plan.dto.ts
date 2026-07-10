import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DistributePlanDto {
  @ApiProperty({
    example: 36,
    description:
      "Jami darslar soni. Berilmasa guruhning endDate yoki durationMonths qiymatidan hisoblanadi",
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalLessons?: number;

  @ApiProperty({
    example: "Birinchi hafta yengil mavzular bo'lsin",
    description: "AI uchun qo'shimcha ko'rsatmalar",
    required: false,
  })
  @IsOptional()
  @IsString()
  instructions?: string;
}
