import { ApiProperty } from '@nestjs/swagger';
import { AttendanceRowDto } from '@/modules/attendance/dto/attendance-row.dto';

export class AttendanceByDateDto {
  @ApiProperty({
    example: false,
    description:
      'exists=true means attendance rows were found for that date. exists=false is normal (gap) and not an error.',
  })
  exists: boolean;

  @ApiProperty({
    type: [AttendanceRowDto],
    example: [],
    description:
      'When exists=false, rows will be empty. When exists=true, rows contains persisted facts.',
  })
  rows: AttendanceRowDto[];
}

export class LessonDatesViewDto {
  @ApiProperty({
    example: 'Asia/Tashkent',
    description: 'Group timezone used for all date logic in this response.',
  })
  timezone: string;

  @ApiProperty({
    example: '2026-01-06',
    description: 'Today date in group timezone (YYYY-MM-DD).',
  })
  today: string;

  @ApiProperty({
    example: ['2026-01-01', '2026-01-03', '2026-01-06'],
    description:
      'Computed lesson dates (schedule-driven only). This does NOT mean attendance exists.',
  })
  lessonDates: string[];

  @ApiProperty({
    example: {
      '2026-01-06': { exists: false, rows: [] },
      '2026-01-03': { exists: true, rows: [{ id: 1, groupId: 10, studentId: 123, lessonDate: '2026-01-03', status: 'present', comment: null, submittedById: 55, submittedAt: '2026-01-03T10:00:00.000Z', updatedAt: '2026-01-03T10:00:00.000Z' }] },
    },
    description:
      'Keyed by lessonDate. Missing attendance rows are expected and represented as exists=false.',
  })
  attendanceByDate: Record<string, AttendanceByDateDto>;
}


