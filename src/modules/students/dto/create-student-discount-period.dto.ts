import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStudentDiscountPeriodDto {
  @ApiProperty({ example: 10, description: 'Discount percent (0..100)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percent: number;

  @ApiProperty({
    example: '2026-01',
    description: 'Start month (YYYY-MM), inclusive',
  })
  @IsString()
  fromMonth: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '2026-03',
    description:
      'End month (YYYY-MM), EXCLUSIVE boundary. Example: from=2026-01, to=2026-02 means only January. Omit/null for permanent.',
  })
  @IsOptional()
  @IsString()
  toMonth?: string | null;

  @ApiProperty({ required: false, example: 'Referral promo' })
  @IsOptional()
  @IsString()
  reason?: string;
}

