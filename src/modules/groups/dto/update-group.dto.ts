import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ScheduleDayDto } from '@/modules/group_schedule/dto/schedule-day.dto';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';

export class UpdateGroupDto {
  @ApiProperty({
    example: 'Frontend guruxi',
    description: 'Gurux nomi',
    required: false,
  })
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 'Asia/Tashkent',
    required: false,
    description: 'Gurux timezone (IANA)',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({
    example: '2026-01-01',
    required: false,
    description: 'Gurux startDate (DATE)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    example: '2026-06-01',
    required: false,
    description:
      "Guruh darslari tugash sanasi (inclusive). Darslar, to'lovlar va " +
      'guruh statusi shu sanaga qarab hisoblanadi. null yuborilsa muddat olib tashlanadi.',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({
    example: GroupStatus.NEW,
    enum: GroupStatus,
    required: false,
    description:
      "Gurux statusi. Tavsiya: statusni o'zgartirish uchun alohida API ishlating.",
  })
  @IsOptional()
  status?: GroupStatus;

  @IsOptional()
  @ApiProperty({
    example: 2,
    description: 'Tanlangan fan idsi',
    required: false,
  })
  @IsNumber()
  subjectId?: number;

  @ApiProperty({
    example: 2,
    description: "Guruxga biriktirilgan o'qituvchi idsi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  teacherId?: number;

  @ApiProperty({
    example: 2,
    description: 'Guruxga biriktirilgan xona idsi',
  })
  @IsOptional()
  @IsNumber()
  roomId?: number;

  @ApiProperty({
    example: 400000,
    description:
      "Bu guruxdagi o'quvchilarning default oylik to'lovi. " +
      "DIQQAT: narx o'zgartirilsa u DEFAULT holatda KEYINGI OYDAN kuchga " +
      "kiradi — joriy va o'tgan oylar to'lovlari (to'langan ham, to'lanmagan " +
      "ham) eski narxda qoladi. Shu oydan qo'llash uchun `applyFeeFrom` " +
      "ni 'current_month' qilib yuboring. O'quvchining shaxsiy narxi " +
      "(students.monthlyFee > 0) bo'lsa, unga guruh narxi umuman ta'sir qilmaydi.",
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyFee?: number;

  @ApiProperty({
    example: 'next_month',
    enum: ['next_month', 'current_month'],
    required: false,
    description:
      "Yangi narx qachondan kuchga kirsin. Default — 'next_month'. " +
      "'current_month' faqat xato kiritilgan narxni tuzatish uchun: shu oyning " +
      "ochiq (to'lanmagan/qisman) to'lovlari qayta hisoblanadi, to'langanlari " +
      'baribir tegilmaydi.',
  })
  @IsOptional()
  @IsIn(['next_month', 'current_month'])
  applyFeeFrom?: 'next_month' | 'current_month';

  @ApiProperty({
    description: 'Group schedule',
    type: [ScheduleDayDto],
    example: [
      { day: 'monday', startTime: '14:30' },
      { day: 'wednesday', startTime: '14:30' },
      { day: 'friday', startTime: '14:30' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days?: ScheduleDayDto[];

  @ApiProperty({
    example: 3,
    description:
      "Gurux qaysi centerga qo'shilayotgani, centerId faqat admin gurux yaratayotganda yuboriladi boshqa vaqt kerak emas",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;
}
