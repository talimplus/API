import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
} from 'class-validator';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';

export class ChangeGroupStatusDto {
  @ApiProperty({ enum: GroupStatus, example: GroupStatus.STARTED })
  @IsEnum(GroupStatus)
  status: GroupStatus;

  @ApiProperty({
    required: false,
    example: '2026-10-20',
    description:
      "Faqat `started` uchun: darslar haqiqatda boshlangan sana (o'tgan sana " +
      "ham bo'lishi mumkin). Guruh `startDate` i shu sanaga qo'yiladi va " +
      "to'lovlar shundan hisoblanadi. Bugundan keyin bo'lolmaydi.",
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    required: false,
    type: [Number],
    description:
      "`startDate` bilan: a'zoligi ham shu sanaga suriladigan o'quvchilar " +
      '(`POST /groups/:id/start-date/preview` dagi `candidates` dan). ' +
      "Berilmasa — barcha nomzodlar. Bo'sh massiv — hech kim.",
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  backdateStudentIds?: number[];
}
