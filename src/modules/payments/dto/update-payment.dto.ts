import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class UpdatePaymentDto {
  @ApiProperty({
    example: '2026-01-20',
    required: false,
    description:
      'Planned study end date for this month (YYYY-MM-DD). If set, student plans to study only until this date (inclusive). Used to calculate prorated payment amount.',
  })
  @IsOptional()
  @IsDateString()
  plannedStudyUntilDate?: string;
}
