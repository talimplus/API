import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus } from '@/modules/attendance/enums/attendance-status.enum';

export class SubmitAttendanceItemDto {
  @ApiProperty({ example: 123 })
  @IsInt()
  studentId: number;

  @ApiProperty({ enum: AttendanceStatus, example: AttendanceStatus.PRESENT })
  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @ApiProperty({
    required: false,
    example: "Kasal bo'lgani uchun",
    description:
      'Optional note. REQUIRED when status is "excused" (sababli) — used as the excuse reason and to justify the payment deduction.',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class SubmitAttendanceDto {
  @ApiProperty({
    example: '2026-01-06',
    description:
      'Lesson date (DATE, local to group timezone). This endpoint creates/updates attendance facts only for this date.',
  })
  @IsDateString()
  lessonDate: string;

  @ApiProperty({
    type: [SubmitAttendanceItemDto],
    description: 'Per-student attendance facts for that lessonDate.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitAttendanceItemDto)
  items: SubmitAttendanceItemDto[];
}
