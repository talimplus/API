import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';
import { LeadStatus } from '@/modules/leads/enums/lead-status.enum';

export class CreateLeadDto {
  @ApiProperty({ example: '998901234567', description: 'Lead phone (required)' })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({ example: 'Ali', required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ example: 'Valiyev', required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ example: '998911112233', required: false })
  @IsOptional()
  @IsString()
  secondPhone?: string;

  @ApiProperty({ example: '2006-05-12', required: false })
  @IsOptional()
  @IsString()
  birthDate?: string;

  @ApiProperty({ example: 400000, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyFee?: number;

  @ApiProperty({ example: 10, required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiProperty({ example: 'Referral discount', required: false })
  @IsOptional()
  @IsString()
  discountReason?: string;

  @ApiProperty({ example: "Lead haqida izoh", required: false })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiProperty({ example: 'Instagram', required: false })
  @IsOptional()
  @IsString()
  heardAboutUs?: string;

  @ApiProperty({ enum: StudentPreferredTime, required: false })
  @IsOptional()
  @IsEnum(StudentPreferredTime)
  preferredTime?: StudentPreferredTime;

  @ApiProperty({ enum: WeekDay, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @IsEnum(WeekDay, { each: true })
  preferredDays?: WeekDay[];

  @ApiProperty({ example: 'AA', required: false })
  @IsOptional()
  @IsString()
  passportSeries?: string;

  @ApiProperty({ example: '1234567', required: false })
  @IsOptional()
  @IsString()
  passportNumber?: string;

  @ApiProperty({ example: '12345678901234', required: false })
  @IsOptional()
  @IsString()
  jshshir?: string;

  @ApiProperty({ enum: LeadStatus, required: false, default: LeadStatus.NEW })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiProperty({
    example: [7, 8],
    required: false,
    description: 'Optional group IDs to attach to lead (for easy transfer).',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  groupIds?: number[];

  @ApiProperty({
    example: 2,
    required: false,
    description:
      "centerId faqat admin/super_admin lead yaratishda yuborishi mumkin (aks holda tokendan olinadi)",
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;
}

