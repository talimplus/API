import { ApiProperty } from '@nestjs/swagger';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { StudentDiscountPeriodResponseDto } from '@/modules/students/dto/student-discount-period-response.dto';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';
import { StudentReturnLikelihood } from '@/common/enums/student-return-likelihood.enum';
import { SubjectResponseDto } from '@/modules/subjects/dto/subject-response.dto';

export class StudentResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Ali' })
  firstName: string;

  @ApiProperty({ example: 'Valiyev' })
  lastName: string;

  @ApiProperty({ example: '998001234567' })
  phone: string;

  @ApiProperty({ example: '998901234567', required: false, nullable: true })
  secondPhone?: string | null;

  @ApiProperty({ example: '2006-05-12', required: false, nullable: true })
  birthDate?: string | null;

  @ApiProperty({
    example: "O'quvchi haqida izoh",
    required: false,
    nullable: true,
  })
  comment?: string | null;

  @ApiProperty({
    example: 'Instagram',
    required: false,
    nullable: true,
    description: "O'quv markazi haqida qayerdan eshitgani",
  })
  heardAboutUs?: string | null;

  @ApiProperty({
    enum: StudentPreferredTime,
    required: false,
    nullable: true,
    description: "Qaysi vaqtda o'qimoqchi (ertalab/kechqurun)",
  })
  preferredTime?: StudentPreferredTime | null;

  @ApiProperty({
    enum: WeekDay,
    isArray: true,
    required: false,
    nullable: true,
    description: "Qaysi kunlari o'qimoqchi (hafta kunlari)",
  })
  preferredDays?: WeekDay[] | null;

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

  @ApiProperty({ example: 400000 })
  monthlyFee: number;

  @ApiProperty({ example: 2 })
  centerId: number;

  @ApiProperty({
    example: [1, 2],
    required: false,
    description: "Student biriktirilgan guruh IDlari",
    type: [Number],
  })
  groupIds?: number[];

  @ApiProperty({
    example: 5,
    required: false,
    nullable: true,
    description:
      "Agar student referral orqali kiritilgan bo'lsa, referrer student ID",
  })
  referrerId?: number | null;

  @ApiProperty({ example: 10, default: 0, description: 'Universal discount %' })
  discountPercent: number;

  @ApiProperty({
    example: 'Referral discount',
    required: false,
    nullable: true,
  })
  discountReason?: string | null;

  @ApiProperty({ enum: StudentStatus, example: StudentStatus.NEW })
  status: StudentStatus;

  @ApiProperty({
    enum: StudentReturnLikelihood,
    required: false,
    nullable: true,
    description:
      'Return likelihood (set when status becomes stopped/ignored). Values: never/maybe/sure.',
  })
  returnLikelihood?: StudentReturnLikelihood | null;

  @ApiProperty({
    example: '2026-01-01T10:00:00.000Z',
    required: false,
    nullable: true,
    description: 'When student became ACTIVE (nullable).',
  })
  activatedAt?: string | null;

  @ApiProperty({
    required: false,
    type: [StudentDiscountPeriodResponseDto],
    description:
      'Optional month-based discount periods (if any). If present, overrides discountPercent for matching months.',
  })
  discountPeriods?: StudentDiscountPeriodResponseDto[];

  @ApiProperty({
    required: false,
    nullable: true,
    type: () => SubjectResponseDto,
    description: "O'quvchi fan ma'lumotlari (optional)",
  })
  subject?: SubjectResponseDto | null;
}
