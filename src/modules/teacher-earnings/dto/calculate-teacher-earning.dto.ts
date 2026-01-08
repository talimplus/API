import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CalculateTeacherEarningDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  teacherId: number;

  @ApiProperty({ example: '2025-12', description: 'Month being earned (YYYY-MM)' })
  @IsString()
  forMonth: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

