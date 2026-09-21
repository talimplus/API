import { ApiProperty } from '@nestjs/swagger';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';

export class StaffOverviewUserDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 'Aziz' }) firstName: string;
  @ApiProperty({ example: 'Karimov' }) lastName: string;
  @ApiProperty({ example: '+998901234567' }) phone: string;
  @ApiProperty({ example: 'teacher' }) role: string;
  @ApiProperty({ example: 'Kassir', nullable: true }) roleName: string | null;
  @ApiProperty({ example: 'Chilonzor filiali', nullable: true })
  centerName: string | null;
  @ApiProperty({ example: 2000000 }) salary: number;
  @ApiProperty({ example: 30 }) commissionPercentage: number;
}

export class StaffOverviewSummaryDto {
  @ApiProperty({ example: 18, description: 'Darsi bo‘lgan kunlar' })
  expectedDays: number;

  @ApiProperty({ example: 17 }) attendedDays: number;
  @ApiProperty({
    example: 1,
    description: 'Darsi bor edi, kelgani belgilanmagan',
  })
  missedDays: number;

  @ApiProperty({ example: 4 }) lateDays: number;
  @ApiProperty({ example: 63, description: 'Jami kechikish, daqiqa' })
  totalLateMinutes: number;

  @ApiProperty({ example: 2, description: 'Shubhali davomat yozuvlari' })
  flaggedDays: number;

  @ApiProperty({
    example: 3,
    description: 'Qabul qilgan, lekin admin tasdiqlamagan cheklar soni',
  })
  unsettledCount: number;

  @ApiProperty({ example: 750000, description: 'Topshirilmagan summa' })
  unsettledAmount: number;

  @ApiProperty({ example: 1, description: 'Admin rad etgan cheklar soni' })
  rejectedCount: number;

  @ApiProperty({ example: 200000 }) rejectedAmount: number;

  @ApiProperty({
    example: 150000,
    description: 'Shu oy uchun yozilgan jarimalar',
  })
  deductionThisMonth: number;

  @ApiProperty({
    example: 200000,
    description:
      'Hali ushlanmagan jarima qoldig‘i — keyingi oyliklardan ushlanadi',
  })
  deductionOutstanding: number;
}

export class StaffOverviewMonthDto {
  @ApiProperty({ example: '2026-09-01' }) month: string;
  @ApiProperty({ example: 18 }) expectedDays: number;
  @ApiProperty({ example: 17 }) attendedDays: number;
  @ApiProperty({ example: 1 }) missedDays: number;
  @ApiProperty({ example: 4 }) lateDays: number;
  @ApiProperty({ example: 63 }) totalLateMinutes: number;
  @ApiProperty({ example: 0 }) flaggedDays: number;
}

export class StaffDeductionDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 150000 }) amount: number;
  @ApiProperty({
    example: 100000,
    description: 'Oyliklardan ushlab qolingan qism',
  })
  appliedAmount: number;
  @ApiProperty({ example: 50000, description: 'Qolgan qarz' })
  remainingAmount: number;
  @ApiProperty({ enum: StaffDeductionType }) type: StaffDeductionType;
  @ApiProperty({ example: 'Sentabrda 3 marta kechikdi' }) reason: string;
  @ApiProperty({ example: '2026-09-01' }) sourceForMonth: string | null;
  @ApiProperty({ nullable: true }) settledAt: Date | null;
}

export class StaffOverviewSalaryDto {
  @ApiProperty({ example: 5 }) id: number;
  @ApiProperty({ example: '2026-09-01' }) forMonth: string;
  @ApiProperty({
    example: 3000000,
    description: 'Hisoblangan oylik (jarimasiz)',
  })
  baseSalary: number;
  @ApiProperty({
    example: 300000,
    description: 'Shu oy ushlab qolingan jarima',
  })
  deductionAmount: number;
  @ApiProperty({ example: 2700000, description: 'Qo‘lga tegadigan summa' })
  netSalary: number;
  @ApiProperty({ example: 1000000 }) paidAmount: number;
  @ApiProperty({ example: 1700000 }) remaining: number;
  @ApiProperty({ example: 'partial' }) status: string;
}

export class StaffOverviewResponseDto {
  @ApiProperty({ type: StaffOverviewUserDto }) user: StaffOverviewUserDto;
  @ApiProperty({ example: '2026-09-01' }) forMonth: string;
  @ApiProperty({ type: StaffOverviewSummaryDto })
  summary: StaffOverviewSummaryDto;
  @ApiProperty({ type: [StaffOverviewMonthDto] })
  months: StaffOverviewMonthDto[];

  @ApiProperty({
    type: [Object],
    description: 'Shu oydagi kechikkan kunlar (davomat yozuvlari)',
  })
  lateRecords: unknown[];

  @ApiProperty({
    type: [Object],
    description: 'Shu oydagi barcha davomat yozuvlari',
  })
  attendanceRecords: unknown[];

  @ApiProperty({
    type: [Object],
    description: 'Qabul qilgan, lekin tasdiqlanmagan/rad etilgan cheklar',
  })
  unsettledReceipts: unknown[];

  @ApiProperty({ type: [StaffDeductionDto] }) deductions: StaffDeductionDto[];

  @ApiProperty({ type: StaffOverviewSalaryDto, nullable: true })
  salary: StaffOverviewSalaryDto | null;
}
