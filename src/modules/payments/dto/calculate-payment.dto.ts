import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty } from 'class-validator';

export class CalculatePaymentDto {
  @ApiProperty({
    example: '2026-01-20',
    description:
      'Planned study end date for this month (YYYY-MM-DD). Student plans to study only until this date (inclusive).',
  })
  @IsNotEmpty()
  @IsDateString()
  plannedStudyUntilDate: string;
}
