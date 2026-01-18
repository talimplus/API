import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadStatus } from '@/modules/leads/enums/lead-status.enum';

export class ChangeLeadStatusDto {
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.DISCARDED })
  @IsEnum(LeadStatus)
  status: LeadStatus;

  @ApiProperty({
    example: "Telefon qildik, o'qishni xohlamadi",
    required: false,
    description: 'Optional reason (will be appended to comment).',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

