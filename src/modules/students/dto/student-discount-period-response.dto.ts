import { ApiProperty } from '@nestjs/swagger';

export class StudentDiscountPeriodResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 10 })
  studentId: number;

  @ApiProperty({ example: 15 })
  percent: number;

  @ApiProperty({ example: '2026-01-01' })
  fromMonth: string;

  @ApiProperty({ required: false, nullable: true, example: '2026-03-01' })
  toMonth?: string | null;

  @ApiProperty({ required: false, nullable: true, example: 'Referral discount' })
  reason?: string | null;

  @ApiProperty({ example: '2026-01-10T10:00:00.000Z' })
  createdAt: string;
}

