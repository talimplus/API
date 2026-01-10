import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateStudentDiscountPeriodDto {
  @ApiProperty({ required: false, example: 10, description: 'Discount percent (0..100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percent?: number;

  @ApiProperty({ required: false, example: '2026-01', description: 'Start month (YYYY-MM), inclusive' })
  @IsOptional()
  @IsString()
  fromMonth?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '2026-03',
    description: 'End month (YYYY-MM), inclusive. Set null to make permanent.',
  })
  @IsOptional()
  @IsString()
  toMonth?: string | null;

  @ApiProperty({ required: false, example: 'Referral promo' })
  @IsOptional()
  @IsString()
  reason?: string;
}

