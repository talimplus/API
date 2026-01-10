import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '@/modules/payments/entities/payment.entity';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';

class MoneySummaryDto {
  @ApiProperty({ example: 1000000 })
  amountDue: number;

  @ApiProperty({ example: 800000 })
  amountPaid: number;

  @ApiProperty({ example: 200000, description: 'amountDue - amountPaid' })
  remainingAmount: number;
}

class PaymentsDashboardDto extends MoneySummaryDto {
  @ApiProperty({ enum: PaymentStatus })
  statusEnum: typeof PaymentStatus;

  @ApiProperty({ example: 100 })
  totalCount: number;

  @ApiProperty({ example: 40 })
  paidCount: number;

  @ApiProperty({ example: 30 })
  partialCount: number;

  @ApiProperty({ example: 30 })
  unpaidCount: number;
}

class PayrollDashboardDto extends MoneySummaryDto {
  @ApiProperty({ enum: StaffSalaryStatus })
  statusEnum: typeof StaffSalaryStatus;

  @ApiProperty({ example: 12 })
  totalCount: number;

  @ApiProperty({ example: 6 })
  paidCount: number;

  @ApiProperty({ example: 3 })
  partialCount: number;

  @ApiProperty({ example: 3 })
  unpaidCount: number;
}

class StudentsDashboardDto {
  @ApiProperty({ example: 120 })
  totalCount: number;

  @ApiProperty({ example: 80 })
  activeCount: number;

  @ApiProperty({ example: 7, description: 'students.createdAt in range' })
  addedCount: number;

  @ApiProperty({ example: 2, description: 'students.stoppedAt in range' })
  stoppedCount: number;
}

class ExpensesDashboardDto {
  @ApiProperty({ example: 250000 })
  totalAmount: number;

  @ApiProperty({ example: 12 })
  totalCount: number;
}

export class DashboardResponseDto {
  @ApiProperty({ example: 1 })
  centerId: number;

  @ApiProperty({ example: '2026-01' })
  fromMonth: string;

  @ApiProperty({ example: '2026-03' })
  toMonth: string;

  @ApiProperty({
    example: { amountDue: 1000000, amountPaid: 800000, remainingAmount: 200000 },
  })
  payments: PaymentsDashboardDto;

  @ApiProperty({
    example: { totalAmount: 300000, totalCount: 10 },
  })
  expenses: ExpensesDashboardDto;

  @ApiProperty({
    example: { amountDue: 500000, amountPaid: 350000, remainingAmount: 150000 },
  })
  payroll: PayrollDashboardDto;

  @ApiProperty({ type: () => StudentsDashboardDto })
  students: StudentsDashboardDto;

  @ApiProperty({
    example: 150000,
    description: 'payments.amountPaid - expenses.totalAmount - payroll.amountPaid',
  })
  netCashflow: number;
}

