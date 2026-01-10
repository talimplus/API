import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateExpenseDto {
  @ApiProperty({ required: false, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  centerId?: number;

  @ApiProperty({ required: false, example: 'Rent' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, example: 1500000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiProperty({ required: false, example: 'Office rent' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    required: false,
    example: '2026-01',
    description: 'Month in YYYY-MM.',
  })
  @IsOptional()
  @IsString()
  forMonth?: string;
}

