import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStudentDiscountPeriodDto {
  @ApiProperty({
    required: false,
    example: 10,
    description:
      'Discount percent (0..100). Either `percent` or `amount` — exactly one of them > 0.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percent?: number;

  @ApiProperty({
    required: false,
    example: 20000,
    description:
      "Fixed discount per month (so'm). Applied to FULL months only — a student who joined mid-month gets it from the next month.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 12,
    description:
      'Limit the discount to one group (e.g. the cheaper subject of a two-subject student). Omit/null — all groups.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  groupId?: number | null;

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
