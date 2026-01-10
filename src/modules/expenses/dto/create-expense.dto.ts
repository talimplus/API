import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExpenseDto {
  @ApiProperty({ example: 2, required: false, description: 'Center id (optional if user has centerId)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  centerId?: number;

  @ApiProperty({ example: 'Rent' })
  @IsString()
  name: string;

  @ApiProperty({ example: 1500000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ required: false, example: 'Office rent' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    required: false,
    example: '2026-01',
    description: 'Month in YYYY-MM. Defaults to current month.',
  })
  @IsOptional()
  @IsString()
  forMonth?: string;
}

