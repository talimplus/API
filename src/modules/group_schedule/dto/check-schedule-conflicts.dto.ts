import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScheduleDayDto } from './schedule-day.dto';

/**
 * Guruh saqlanmasdan turib xona/o'qituvchi bandligini tekshirish uchun.
 * Forma har bir o'zgarishda shu endpointga murojaat qiladi va natijani
 * input ostida ko'rsatadi — foydalanuvchi "Saqlash" bosgandan keyin emas,
 * **oldin** biladi.
 */
export class CheckScheduleConflictsDto {
  @ApiProperty({
    type: [ScheduleDayDto],
    description: 'Tekshiriladigan darslar',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days: ScheduleDayDto[];

  @ApiProperty({ required: false, example: 3, description: 'Tanlangan xona' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  roomId?: number;

  @ApiProperty({
    required: false,
    example: 7,
    description: "Tanlangan o'qituvchi",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  teacherId?: number;

  @ApiProperty({
    required: false,
    example: 90,
    description: 'Dars davomiyligi (daqiqa, default 90)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  lessonDurationMinutes?: number;

  @ApiProperty({
    required: false,
    example: 12,
    description:
      "Tahrirlanayotgan guruh — o'zining jadvali to'qnashuv sifatida sanalmasligi uchun",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  excludeGroupId?: number;
}
