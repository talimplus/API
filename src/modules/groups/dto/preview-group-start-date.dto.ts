import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDateString, IsInt, IsOptional } from 'class-validator';

export class PreviewGroupStartDateDto {
  @ApiProperty({
    example: '2026-10-20',
    description: 'Yangi boshlanish sanasi',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    required: false,
    type: [Number],
    description:
      "A'zoligi ham suriladigan o'quvchilar. Berilmasa — barcha nomzodlar.",
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  backdateStudentIds?: number[];
}
