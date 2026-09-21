import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ScheduleDayDto } from '@/modules/group_schedule/dto/schedule-day.dto';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';

export class CreateGroupDto {
  @ApiProperty({
    example: 'Frontend guruxi',
    description: 'Gurux nomi',
  })
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'Asia/Tashkent',
    description:
      "Gurux timezone (IANA). Barcha attendance lessonDate logikasi shu timezone bo'yicha ishlaydi.",
    required: false,
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({
    example: '2026-01-01',
    description:
      'Gurux boshlanish sanasi (DATE). Lesson existence faqat schedule + shu chegara asosida hisoblanadi.',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    example: '2026-06-01',
    description:
      'Guruh darslari tugash sanasi (inclusive). Yaratishda ixtiyoriy, lekin ' +
      "guruh statusini o'zgartirishda (masalan `started` qilishda) majburiy. " +
      "Darslar, to'lovlar va guruhning avtomatik yopilishi shu sanaga qarab ishlaydi.",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({
    example: 90,
    required: false,
    description:
      "Bitta darsning davomiyligi (daqiqa, default 90). Xona va o'qituvchi " +
      "bandligi shu qiymat bo'yicha tekshiriladi: " +
      '[startTime .. startTime + davomiylik).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  lessonDurationMinutes?: number;

  @ApiProperty({
    example: GroupStatus.NEW,
    enum: GroupStatus,
    required: false,
    description:
      "Gurux statusi (default: new). Statusni o'zgartirish uchun alohida API ishlatiladi.",
  })
  @IsOptional()
  status?: GroupStatus;

  @ApiProperty({
    example: 2,
    description: 'Tanlangan fan idsi',
  })
  @IsNumber()
  subjectId: number;

  @ApiProperty({
    example: 2,
    description: "Guruxga biriktirilgan o'qituvchi idsi",
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
    description: "Bu guruxdagi o'quvchilarning default oylik to'lovi",
  })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  monthlyFee: number;

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
