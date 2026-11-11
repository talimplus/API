import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
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

  @ApiProperty({
    required: false,
    example: '2026-10-20',
    description:
      "Faqat `stopped` uchun: o'quvchi o'qishni to'xtatgan kun (o'tgan sana " +
      "bo'lishi mumkin, exclusive — shu kundan boshlab darslar to'lovga " +
      "kirmaydi). Bugundan keyin, faollashgan/guruhga qo'shilgan kundan oldin " +
      "bo'lolmaydi; shu kundan keyin 'keldi/kechikdi' davomati bo'lsa — 422. " +
      'Default — bugun.',
  })
  @IsOptional()
  @IsDateString()
  stopDate?: string;

  @ApiProperty({
    required: false,
    example: '2026-11-01',
    description:
      "Faqat QAYTISHDA (stopped/finished → active): o'quvchi qaytadan " +
      "o'qiy boshlagan kun. Status o'zgargan kundan (`GET /students/:id/reactivation` " +
      "→ `statusChangedOn`) oldin va bugundan keyin bo'lolmaydi. Status o'zgargan " +
      "kun tanlansa — uzilish yo'q (xato bosilgan status to'liq bekor bo'ladi). " +
      "Oradagi kunlarga 'keldi/kechikdi' davomati bo'lsa — 422. Default — bugun.",
  })
  @IsOptional()
  @IsDateString()
  returnDate?: string;

  @ApiProperty({
    required: false,
    example: 12,
    description:
      "Faqat QAYTISHDA: o'quvchini shu guruhga ham qo'shadi (`returnDate` dan). " +
      "Davom etadigan guruhi qolmagan o'quvchi uchun (masalan yagona guruhidan " +
      "chiqarilgan) — majburiy. Guruh shu filialdan va tugamagan bo'lishi kerak.",
  })
  @IsOptional()
  @IsInt()
  groupId?: number;
}
