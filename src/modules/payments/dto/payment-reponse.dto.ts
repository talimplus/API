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

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PARTIAL })
  status: PaymentStatus;

  @ApiProperty({ example: '2025-06-01', description: 'First day of month (DATE)' })
  forMonth: string;

  @ApiProperty({ example: '2025-05-18T21:00:00.000Z' })
  createdAt: string;
}
