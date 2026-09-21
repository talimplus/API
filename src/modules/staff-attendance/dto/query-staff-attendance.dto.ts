import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Min,
} from 'class-validator';
import { AttendanceConfidence } from '../enums/staff-attendance.enum';

const toBool = ({ value }: { value: any }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1')
    return true;
  if (value === false || value === 'false' || value === 0 || value === '0')
    return false;
  return value;
};

export class QueryStaffAttendanceDto {
  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage?: number;

  @ApiProperty({ required: false, description: 'Filial' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  centerId?: number;

  @ApiProperty({ required: false, description: 'Aniq bir xodim' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userId?: number;

  @ApiProperty({ required: false, example: '2026-09-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiProperty({ required: false, example: '2026-09-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiProperty({ required: false, enum: AttendanceConfidence })
  @IsOptional()
  @IsEnum(AttendanceConfidence)
  confidence?: AttendanceConfidence;

  @ApiProperty({
    required: false,
    description: 'Faqat shubhali yozuvlar (bayroqchasi bor yoki ishonch past)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  onlyFlagged?: boolean;

  @ApiProperty({ required: false, description: 'Faqat kechikkanlar' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  onlyLate?: boolean;
}
