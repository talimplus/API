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

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PARTIAL })
  status: PaymentStatus;

  @ApiProperty({ example: '2025-06-01' })
  forMonth: Date;

  @ApiProperty({ example: '2025-05-18T21:00:00.000Z' })
  createdAt: Date;
}
