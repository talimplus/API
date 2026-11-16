import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  StatsIncomeStatus,
  StatsStudentsKind,
} from '@/modules/statistics/statistics-details.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class StatsRangeQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Filial. Berilmasa — xodimning filiali yoki butun tashkilot.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  centerId?: number;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description:
      'Boshi (inclusive), YYYY-MM-DD. Default — joriy oyning 1-sanasi.',
  })
  @IsOptional()
  @IsString()
  @Matches(DAY)
  fromDate?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description:
      'Oxiri (inclusive), YYYY-MM-DD. Default — oyning oxirgi kuni (fromDate berilsa — fromDate).',
  })
  @IsOptional()
  @IsString()
  @Matches(DAY)
  toDate?: string;
}

export class StatsDetailsQueryDto extends StatsRangeQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  perPage?: number;

  @ApiPropertyOptional({
    description: "Ism / telefon (xarajatda — nomi) bo'yicha qidiruv",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class StatsIncomeQueryDto extends StatsDetailsQueryDto {
  @ApiPropertyOptional({
    enum: StatsIncomeStatus,
    default: StatsIncomeStatus.CONFIRMED,
  })
  @IsOptional()
  @IsEnum(StatsIncomeStatus)
  status?: StatsIncomeStatus;
}

export class StatsStudentsQueryDto extends StatsDetailsQueryDto {
  @ApiPropertyOptional({
    enum: StatsStudentsKind,
    default: StatsStudentsKind.STARTED,
  })
  @IsOptional()
  @IsEnum(StatsStudentsKind)
  kind?: StatsStudentsKind;
}

export class StatsTrendQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  centerId?: number;

  @ApiPropertyOptional({
    enum: [3, 6, 12, 24],
    default: 6,
    description: 'Nechta oy (joriy oy bilan)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([3, 6, 12, 24])
  months?: number;
}
