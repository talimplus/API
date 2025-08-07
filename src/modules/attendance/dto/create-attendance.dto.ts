import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateAttendanceDto {
  @ApiProperty({ example: '2025-08-06' })
  @IsDateString()
  date: string;

  @ApiProperty()
  @IsBoolean()
  isPresent: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty()
  @IsNumber()
  studentId: number;

  @ApiProperty()
  @IsNumber()
  groupId: number;
}
