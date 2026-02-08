import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class RescheduleLessonDto {
  @ApiProperty({
    example: '2026-01-08',
    description:
      'New lesson date (YYYY-MM-DD, group timezone). The missed lesson is assumed to be today in group timezone.',
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
