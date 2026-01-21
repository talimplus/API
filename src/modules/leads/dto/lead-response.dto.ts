import { ApiProperty } from '@nestjs/swagger';
import { LeadStatus } from '@/modules/leads/enums/lead-status.enum';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';

export class LeadResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '998901234567' })
  phone: string;

  @ApiProperty({ example: 'Ali', required: false, nullable: true })
  firstName?: string | null;

  @ApiProperty({ example: 'Valiyev', required: false, nullable: true })
  lastName?: string | null;

  @ApiProperty({ example: '998911112233', required: false, nullable: true })
  secondPhone?: string | null;

  @ApiProperty({ example: '2006-05-12', required: false, nullable: true })
  birthDate?: string | null;

  @ApiProperty({ example: 400000, required: false, nullable: true })
  monthlyFee?: number | null;

  @ApiProperty({ example: 10, default: 0 })
  discountPercent: number;

  @ApiProperty({ example: 'Referral discount', required: false, nullable: true })
  discountReason?: string | null;

  @ApiProperty({ required: false, nullable: true })
  comment?: string | null;

  @ApiProperty({ required: false, nullable: true })
  heardAboutUs?: string | null;

  @ApiProperty({ enum: StudentPreferredTime, required: false, nullable: true })
  preferredTime?: StudentPreferredTime | null;

  @ApiProperty({ enum: WeekDay, isArray: true, required: false, nullable: true })
  preferredDays?: WeekDay[] | null;

  @ApiProperty({ enum: LeadStatus, example: LeadStatus.NEW })
  status: LeadStatus;

  @ApiProperty({ example: 2 })
  centerId: number;

  @ApiProperty({
    example: [7, 8],
    required: false,
    description: 'Attached group IDs (if any).',
    type: [Number],
  })
  groupIds?: number[];

  @ApiProperty({
    example: 11,
    required: false,
    nullable: true,
    description: 'Created student id if lead was converted.',
  })
  studentId?: number | null;

  @ApiProperty({
    example: '2026-01-20',
    required: false,
    nullable: true,
    description: 'Follow-up date: when to contact the lead again (YYYY-MM-DD format)',
  })
  followUpDate?: string | null;

  @ApiProperty({ example: '2026-01-17T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-01-17T10:00:00.000Z' })
  updatedAt: string;

  @ApiProperty({
    example: 'AA',
    required: false,
    nullable: true,
    description:
      'Passport series (only visible to ADMIN/SUPER_ADMIN in list endpoints)',
  })
  passportSeries?: string | null;

  @ApiProperty({
    example: '1234567',
    required: false,
    nullable: true,
    description:
      'Passport number (only visible to ADMIN/SUPER_ADMIN in list endpoints)',
  })
  passportNumber?: string | null;

  @ApiProperty({
    example: '12345678901234',
    required: false,
    nullable: true,
    description: 'JSHSHIR (only visible to ADMIN/SUPER_ADMIN in list endpoints)',
  })
  jshshir?: string | null;
}

