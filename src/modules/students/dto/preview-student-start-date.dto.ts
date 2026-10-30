import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDateString, IsInt, IsOptional } from 'class-validator';

export class PreviewStudentStartDateDto {
  @ApiProperty({
    example: '2026-10-20',
    description: "O'qishni boshlagan sana",
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    required: false,
    type: [Number],
    description:
      "Tahrirda qo'shilayotgan YANGI guruhlar. Berilmasa — birinchi " +
      "faollashtirish (o'quvchining hozirgi barcha guruhlari).",
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  groupIds?: number[];
}
