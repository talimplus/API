import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** Doimiy (davrsiz) chegirma — bitta guruhga yoki barcha guruhlarga. */
export class BaseDiscountDto {
  @ApiProperty({
    example: 12,
    required: false,
    nullable: true,
    description: "Qaysi guruhga; bo'sh — barcha guruhlarga",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  groupId?: number | null;

  @ApiProperty({
    example: 10,
    required: false,
    description: 'Foiz (0..100) — `amount` bilan birga emas',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percent?: number;

  @ApiProperty({ example: 20000, required: false, description: "So'm/oy" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}
