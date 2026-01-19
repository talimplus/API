import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '@/modules/payments/entities/payment.entity';
import { StudentResponseDto } from '@/modules/students/dto/student-response.dto';
import { GroupResponseDto } from '@/modules/groups/dto/group-response.dto';

export class PaymentResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ type: () => StudentResponseDto })
  student: StudentResponseDto;

  @ApiProperty({ type: () => GroupResponseDto, nullable: true })
  group: GroupResponseDto;

  @ApiProperty({ example: 250000.0 })
  amountDue: number;

  @ApiProperty({ example: 150000.0 })
  amountPaid: number;

  @ApiProperty({
    example: 50000.0,
    description: 'How much was refunded to the student for this month (cumulative)',
  })
  refundedAmount: number;

  @ApiProperty({
    example: 120000,
    description:
      'How much money was received by reception but is still awaiting admin confirmation (sum of pending receipts).',
  })
  pendingAmount: number;

  @ApiProperty({
    example: true,
    description: 'True if there is at least one pending receipt for this payment.',
  })
  hasPendingReceipt: boolean;

  @ApiProperty({
    example: 2,
    description: 'How many pending receipts exist for this payment.',
  })
  pendingReceiptsCount: number;

  @ApiProperty({
    example: 30,
    description:
      'Total discount percent applied for this payment month (base discount + all matching discount periods).',
  })
  discountPercentApplied: number;

  @ApiProperty({
    example: [
      { percent: 10, reason: 'Base: Referral' },
      { percent: 20, reason: 'Yaxshi o‘qigani uchun' },
    ],
    description: 'Breakdown of all discounts contributing to discountPercentApplied.',
  })
  discountBreakdown: Array<{ percent: number; reason: string }>;

  @ApiProperty({
    example: 100000.0,
    description: 'amountDue - amountPaid',
  })
  remainingAmount: number;

  @ApiProperty({ example: '2026-01-10', description: 'Soft due date (DATE)' })
  dueDate: string;

  @ApiProperty({ example: '2026-01-15', description: 'Hard due date (DATE)' })
  hardDueDate: string;

  @ApiProperty({
    example: true,
    description: 'Overdue if today > hardDueDate and status != PAID',
  })
  isOverdue: boolean;

  @ApiProperty({ example: 12, description: 'Total scheduled lessons in the month' })
  lessonsPlanned: number;

  @ApiProperty({
    example: 8,
    description:
      'How many lessons student must pay for (<= lessonsPlanned). Mid-month activation can reduce it.',
  })
  lessonsBillable: number;

  @ApiProperty({
    example: '2026-01-20',
    required: false,
    nullable: true,
    description:
      'Planned study end date for this month (YYYY-MM-DD). If set, student plans to study only until this date (inclusive). Used to calculate prorated payment amount.',
  })
  plannedStudyUntilDate?: string | null;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PARTIAL })
  status: PaymentStatus;

  @ApiProperty({ example: '2025-06-01', description: 'First day of month (DATE)' })
  forMonth: string;

  @ApiProperty({ example: '2025-05-18T21:00:00.000Z' })
  createdAt: string;
}
