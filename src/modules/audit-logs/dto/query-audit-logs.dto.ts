import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuditAction, AuditModule } from '@/modules/audit-logs/audit-log.enums';

const toBool = ({ value }: { value: any }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
};

/** `GET /audit-logs` filtrlari. */
export class QueryAuditLogsDto {
  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, example: 30, description: 'Max 100' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;

  @ApiProperty({ required: false, example: '2026-11-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fromDate YYYY-MM-DD bo‘lishi kerak',
  })
  fromDate?: string;

  @ApiProperty({ required: false, example: '2026-11-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'toDate YYYY-MM-DD bo‘lishi kerak',
  })
  toDate?: string;

  @ApiProperty({ required: false, description: 'Amalni bajargan xodim' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  actorId?: number;

  @ApiProperty({ required: false, enum: AuditModule })
  @IsOptional()
  @IsEnum(AuditModule)
  module?: AuditModule;

  @ApiProperty({ required: false, enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiProperty({
    required: false,
    description:
      'true — faqat muvaffaqiyatli, false — faqat xato bilan tugaganlar',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  success?: boolean;

  @ApiProperty({
    required: false,
    description: "Manzil, amal nomi yoki obyekt id'si bo'yicha qidiruv",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
