import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';
import {
  AttendanceConfidence,
  AttendanceSource,
} from '../enums/staff-attendance.enum';

export class StaffAttendanceUserDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Aziz' })
  firstName: string;

  @ApiProperty({ example: 'Karimov' })
  lastName: string;

  @ApiProperty({ example: 'teacher' })
  role: string;
}

export class StaffAttendanceResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: StaffAttendanceUserDto })
  user: StaffAttendanceUserDto;

  @ApiProperty({ example: 1, nullable: true })
  centerId: number | null;

  @ApiProperty({ example: '2026-09-21' })
  workDate: string;

  @ApiProperty({ example: '2026-09-21T09:05:00.000Z' })
  checkInAt: Date;

  @ApiProperty({
    example: '09:00:00',
    nullable: true,
    description:
      "Shu kundagi birinchi darsning boshlanish vaqti (darsi bo'lmasa null)",
  })
  firstLessonAt: string | null;

  @ApiProperty({
    example: 5,
    description: 'Kechikish daqiqada (erta kelgan bo‘lsa 0)',
  })
  lateMinutes: number;

  @ApiProperty({ enum: AttendanceSource })
  source: AttendanceSource;

  @ApiProperty({
    enum: AttendanceConfidence,
    description:
      'high — Wi-Fi ham GPS ham mos (yoki tasdiqlangan); medium — bittasi; low — hech biri',
  })
  confidence: AttendanceConfidence;

  @ApiProperty({
    example: 42,
    nullable: true,
    description: 'Markazgacha masofa, metr',
  })
  distanceMeters: number | null;

  @ApiProperty({ example: true, nullable: true })
  geoMatched: boolean | null;

  @ApiProperty({
    example: true,
    nullable: true,
    description: 'Markaz Wi-Fi’sidami',
  })
  ipMatched: boolean | null;

  @ApiProperty({
    example: ['far_from_center'],
    type: [String],
    description: 'Shubhali holatlar ro‘yxati (AttendanceFlag)',
  })
  flags: string[];

  @ApiProperty({ nullable: true })
  confirmedByUserId: number | null;

  @ApiProperty({ nullable: true })
  confirmedAt: Date | null;

  @ApiProperty({ nullable: true })
  note: string | null;
}

export class PaginatedStaffAttendanceResponseDto {
  @ApiProperty({ type: [StaffAttendanceResponseDto] })
  data: StaffAttendanceResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class StaffAttendanceTodayDto {
  @ApiProperty({ example: '2026-09-21' })
  date: string;

  @ApiProperty({ example: true, description: 'Bugun allaqachon belgilanganmi' })
  checkedIn: boolean;

  @ApiProperty({ type: StaffAttendanceResponseDto, nullable: true })
  attendance: StaffAttendanceResponseDto | null;

  @ApiProperty({
    example: '09:00:00',
    nullable: true,
    description: "Bugungi birinchi dars vaqti. null bo'lsa bugun darsi yo'q",
  })
  firstLessonAt: string | null;

  @ApiProperty({ example: 3, description: 'Bugungi darslar soni' })
  lessonsToday: number;

  @ApiProperty({
    example: true,
    description:
      "Markazga koordinata yoki IP kiritilganmi. false bo'lsa tekshiruv ishlamaydi",
  })
  centerConfigured: boolean;
}

export class StaffAttendanceReportRowDto {
  @ApiProperty({ type: StaffAttendanceUserDto })
  user: StaffAttendanceUserDto;

  @ApiProperty({ example: 18, description: 'Darsi bo‘lgan kunlar soni' })
  expectedDays: number;

  @ApiProperty({ example: 17, description: 'Kelgani belgilangan kunlar' })
  attendedDays: number;

  @ApiProperty({
    example: 1,
    description: 'Darsi bor edi, lekin kelgani belgilanmagan',
  })
  missedDays: number;

  @ApiProperty({ example: 4, description: 'Kechikkan kunlar soni' })
  lateDays: number;

  @ApiProperty({ example: 63, description: 'Jami kechikish, daqiqa' })
  totalLateMinutes: number;

  @ApiProperty({ example: 2, description: 'Shubhali yozuvlar soni' })
  flaggedDays: number;
}

export class StaffAttendanceReportDto {
  @ApiProperty({ example: '2026-09-01' })
  from: string;

  @ApiProperty({ example: '2026-09-30' })
  to: string;

  @ApiProperty({
    example: false,
    description:
      "Markaz joylashuvi/IP sozlanmagan bo'lsa true — hisobot ishonchsiz",
  })
  centerNotConfigured: boolean;

  @ApiProperty({ type: [StaffAttendanceReportRowDto] })
  rows: StaffAttendanceReportRowDto[];
}
