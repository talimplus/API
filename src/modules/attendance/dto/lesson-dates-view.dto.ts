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

export class GroupStudentDto {
  @ApiProperty({ example: 123 })
  id: number;

  @ApiProperty({ example: 'Ali' })
  firstName: string;

  @ApiProperty({ example: 'Valiyev' })
  lastName: string;

  @ApiProperty({
    example: '2026-01-15',
    nullable: true,
    description:
      "O'quvchi SHU guruhga qo'shilgan sana (guruh timezone'ida, YYYY-MM-DD). " +
      "Shu sanadan oldingi dars kunlariga davomat yozib bo'lmaydi — server ham " +
      "bunday so'rovni 400 bilan rad etadi. null bo'lsa sana noma'lum (cheklov yo'q).",
  })
  joinedAt: string | null;

  @ApiProperty({
    example: '2026-03-01',
    nullable: true,
    description:
      "O'quvchi SHU guruhdan chiqqan sana (YYYY-MM-DD), **exclusive**: o'sha " +
      "kungi darsga ham davomat yozilmaydi va to'lov hisoblanmaydi. null " +
      "bo'lsa o'quvchi hali guruhda. Boshqa guruhga ko'chirilgan o'quvchi " +
      "jurnalda shu sanagacha ko'rinib turadi (tarix uchun, faqat o'qish).",
  })
  leftAt: string | null;
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
    type: [GroupStudentDto],
    description:
      "Guruhdagi hozirgi o'quvchilar va ularning guruhga qo'shilgan sanasi. " +
      "Davomat jadvalining qatorlari shu ro'yxatdan quriladi: joinedAt dan " +
      'oldingi kataklar tahrirlanmasligi kerak.',
  })
  students: GroupStudentDto[];

  @ApiProperty({
    example: ['2026-01-01', '2026-01-03', '2026-01-06'],
    description:
      'Computed lesson dates (schedule-driven, plus rescheduled extra lessons). This does NOT mean attendance exists.',
  })
  lessonDates: string[];

  @ApiProperty({
    example: {
      '2026-01-06': {
        type: 'cancelled',
        movedTo: '2026-01-08',
        reason: 'Teacher is sick',
      },
      '2026-01-08': {
        type: 'extra',
        movedFrom: '2026-01-06',
        reason: 'Teacher is sick',
      },
    },
    description:
      'Optional overrides for lesson dates (rescheduled lessons). Keyed by date.',
    required: false,
  })
  overridesByDate?: Record<
    string,
    {
      type: 'cancelled' | 'extra';
      movedFrom?: string;
      movedTo?: string;
      reason?: string | null;
      id?: number;
    }
  >;

  @ApiProperty({
    example: {
      '2026-01-06': { exists: false, rows: [] },
      '2026-01-03': {
        exists: true,
        rows: [
          {
            id: 1,
            groupId: 10,
            studentId: 123,
            lessonDate: '2026-01-03',
            status: 'present',
            comment: null,
            submittedById: 55,
            submittedAt: '2026-01-03T10:00:00.000Z',
            updatedAt: '2026-01-03T10:00:00.000Z',
          },
        ],
      },
    },
    description:
      'Keyed by lessonDate. Missing attendance rows are expected and represented as exists=false.',
  })
  attendanceByDate: Record<string, AttendanceByDateDto>;
}
