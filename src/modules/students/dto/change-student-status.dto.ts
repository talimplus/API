import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { StudentReturnLikelihood } from '@/common/enums/student-return-likelihood.enum';

export class ChangeStudentStatusDto {
  @ApiProperty({ enum: StudentStatus, example: StudentStatus.STOPPED })
  @IsEnum(StudentStatus)
  status: StudentStatus;

  @ApiProperty({
    required: false,
    description: 'Optional comment to store on student when changing status.',
    example: "O'qishni xohlamadi, telefon qildik.",
  })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiProperty({
    enum: StudentReturnLikelihood,
    required: false,
    description:
      'Required when status is STOPPED or IGNORED. Values: never/maybe/sure.',
  })
  @IsOptional()
  @IsEnum(StudentReturnLikelihood)
  returnLikelihood?: StudentReturnLikelihood;

  @ApiProperty({
    required: false,
    example: '2026-10-20',
    description:
      "Faqat BIRINCHI faollashtirishda (new/ignored → active): o'quvchi " +
      "darsga qatnay boshlagan sana (o'tgan sana bo'lishi mumkin). To'lov " +
      'shu sanadan hisoblanadi. Default — bugun.',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;
}
