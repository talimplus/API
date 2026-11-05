import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { StudentReturnLikelihood } from '@/common/enums/student-return-likelihood.enum';

/** `POST /students/:id/leave-group` — o'quvchi bitta guruhda o'qishni to'xtatadi. */
export class LeaveGroupDto {
  @ApiProperty({ example: 12, description: "O'quvchi chiqayotgan guruh" })
  @IsInt()
  groupId: number;

  @ApiPropertyOptional({
    example: '2026-11-05',
    description:
      "Shu guruhda o'qishni to'xtatgan kun (exclusive — shu kundan boshlab " +
      "darslar to'lovga kirmaydi). Bugundan keyin va shu guruhga qo'shilgan " +
      "kundan oldin bo'lolmaydi; shu kundan boshlab shu guruhda " +
      "'keldi/kechikdi' davomati bo'lsa — 422. Default — bugun.",
  })
  @IsOptional()
  @IsDateString()
  stopDate?: string;

  @ApiPropertyOptional({
    enum: StudentReturnLikelihood,
    description:
      "Faqat oxirgi tugamagan guruhidan chiqsa majburiy: o'quvchi `stopped` " +
      "bo'ladi. Boshqa guruhlari qolsa e'tiborga olinmaydi.",
  })
  @IsOptional()
  @IsEnum(StudentReturnLikelihood)
  returnLikelihood?: StudentReturnLikelihood;

  @ApiPropertyOptional({ example: "Vaqti to'g'ri kelmadi" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
