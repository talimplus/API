import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { AttendanceStatus } from '@/modules/attendance/enums/attendance-status.enum';

const toBool = ({ value }: { value: any }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
};

/** Kelmagan o'quvchilar ro'yxati filtrlari. */
export class QueryAbsencesDto {
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

  @ApiProperty({
    required: false,
    description: 'Filial (faqat admin tanlaydi)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  centerId?: number;

  @ApiProperty({ required: false, example: '2026-09-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from YYYY-MM-DD bo‘lishi kerak' })
  from?: string;

  @ApiProperty({ required: false, example: '2026-09-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to YYYY-MM-DD bo‘lishi kerak' })
  to?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  groupId?: number;

  @ApiProperty({ required: false, description: "Guruhning o'qituvchisi" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  teacherId?: number;

  @ApiProperty({
    required: false,
    enum: [AttendanceStatus.ABSENT, AttendanceStatus.EXCUSED],
    description: "`absent` — sababsiz, `excused` — sababli. Bo'sh — ikkalasi",
  })
  @IsOptional()
  @IsIn([AttendanceStatus.ABSENT, AttendanceStatus.EXCUSED])
  status?: AttendanceStatus.ABSENT | AttendanceStatus.EXCUSED;

  @ApiProperty({
    required: false,
    description: "true — qo'ng'iroq qilinganlar, false — hali qilinmaganlar",
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  followedUp?: boolean;

  @ApiProperty({ required: false, description: "O'quvchi ismi yoki telefoni" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AbsenceFollowUpDto {
  @ApiProperty({
    example: "Kasal bo'lgan, ertaga keladi",
    description: "Qo'ng'iroq natijasi. Bo'sh satr — belgini olib tashlaydi",
  })
  @IsString()
  @MaxLength(1000)
  note: string;
}
