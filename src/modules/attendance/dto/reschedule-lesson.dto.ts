import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class RescheduleLessonDto {
  @ApiProperty({
    required: false,
    example: '2026-01-06',
    description:
      'Original lesson date to reschedule (YYYY-MM-DD, group timezone). Defaults to today if omitted.',
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiProperty({
    example: '2026-01-08',
    description: 'New lesson date (YYYY-MM-DD, group timezone).',
  })
  @IsDateString()
  toDate: string;

  @ApiProperty({
    required: false,
    example: 'Teacher is sick, moved to Thursday',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
