import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetLessonDatesQueryDto {
  @ApiPropertyOptional({
    example: 'last',
    enum: ['last', 'range'],
    description:
      "Mode: 'last' = last N lessons up to today (group timezone). 'range' = all lessons in [from..to].",
  })
  @IsOptional()
  @IsIn(['last', 'range'])
  mode?: 'last' | 'range';

  @ApiPropertyOptional({
    example: 7,
    description: "Only for mode='last'.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  count?: number;

  @ApiPropertyOptional({
    example: '2026-01-01',
    description: "Only for mode='range'. Inclusive start date (YYYY-MM-DD).",
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-01-31',
    description: "Only for mode='range'. Inclusive end date (YYYY-MM-DD).",
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}


