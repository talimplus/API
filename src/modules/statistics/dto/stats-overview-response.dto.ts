import { ApiProperty } from '@nestjs/swagger';

class AmountCountDto {
  @ApiProperty() amount: number;
  @ApiProperty() count: number;
}

class MethodAmountDto extends AmountCountDto {
  @ApiProperty({ example: 'cash' }) method: string;
}

class IncomeDto extends AmountCountDto {
  @ApiProperty({ type: [MethodAmountDto] }) byMethod: MethodAmountDto[];
}

class SalariesDto extends AmountCountDto {
  @ApiProperty() salaryAmount: number;
  @ApiProperty() advanceAmount: number;
}

class BillingDto {
  @ApiProperty() amountDue: number;
  @ApiProperty() amountPaid: number;
  @ApiProperty() pendingAmount: number;
  @ApiProperty() collectableAmount: number;
  @ApiProperty() totalCount: number;
  @ApiProperty() paidCount: number;
  @ApiProperty() pendingCount: number;
  @ApiProperty() partialCount: number;
  @ApiProperty() unpaidCount: number;
  @ApiProperty() debtorsCount: number;
}

class StudentsDto {
  @ApiProperty({ description: 'Hozir faol' }) active: number;
  @ApiProperty({ description: "Oraliqda o'qishni boshlagan (activatedAt)" })
  started: number;
  @ApiProperty({ description: "Oraliqda ro'yxatga yozilgan (createdAt)" })
  registered: number;
  @ApiProperty({ description: "Oraliqda to'xtatgan (stoppedAt)" })
  stopped: number;
}

export class StatsOverviewResponseDto {
  @ApiProperty({ nullable: true }) centerId: number | null;
  @ApiProperty({ example: '2026-11-01' }) fromDate: string;
  @ApiProperty({ example: '2026-11-30' }) toDate: string;
  @ApiProperty({ example: '2026-11' }) billingFromMonth: string;
  @ApiProperty({ example: '2026-11' }) billingToMonth: string;
  @ApiProperty({
    type: IncomeDto,
    description: 'Tasdiqlangan cheklar (kassaga tushgan)',
  })
  income: IncomeDto;
  @ApiProperty({
    type: AmountCountDto,
    description: 'Qabul qilingan, tasdiq kutayotgan',
  })
  pending: AmountCountDto;
  @ApiProperty({ type: AmountCountDto }) refunds: AmountCountDto;
  @ApiProperty({ type: AmountCountDto }) expenses: AmountCountDto;
  @ApiProperty({ type: SalariesDto }) salaries: SalariesDto;
  @ApiProperty({ description: 'income − refunds − expenses − salaries' })
  balance: number;
  @ApiProperty({ type: BillingDto }) billing: BillingDto;
  @ApiProperty({ type: StudentsDto }) students: StudentsDto;
}

class TrendPointDto {
  @ApiProperty({ example: '2026-11' }) month: string;
  @ApiProperty() income: number;
  @ApiProperty() charged: number;
  @ApiProperty() students: number;
  @ApiProperty() started: number;
  @ApiProperty() stopped: number;
}

export class StatsTrendResponseDto {
  @ApiProperty({ nullable: true }) centerId: number | null;
  @ApiProperty() months: number;
  @ApiProperty({ type: [TrendPointDto] }) points: TrendPointDto[];
}
