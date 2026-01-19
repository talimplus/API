import { ApiProperty } from '@nestjs/swagger';

export class StaffSalaryPaymentHistoryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 200000 })
  amount: number;

  @ApiProperty({ example: 'Paid by bank transfer', required: false, nullable: true })
  comment?: string | null;

  @ApiProperty({ example: '2026-01-15T10:00:00.000Z' })
  paidAt: string;

  @ApiProperty({
    example: { id: 5, firstName: 'Admin', lastName: 'User' },
    required: false,
    nullable: true,
  })
  paidBy?: {
    id: number;
    firstName: string;
    lastName: string;
  } | null;
}
