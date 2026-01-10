import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DashboardQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'Center scope. If omitted, defaults to current user centerId when available.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  centerId?: number;

  @ApiPropertyOptional({
    example: '2026-01',
    description:
      'Start month (inclusive) in YYYY-MM. If omitted, defaults to current month.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  fromMonth?: string;

  @ApiPropertyOptional({
    example: '2026-03',
    description:
      'End month (inclusive) in YYYY-MM. If omitted, defaults to fromMonth.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  toMonth?: string;
}

