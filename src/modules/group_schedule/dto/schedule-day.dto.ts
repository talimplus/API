import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { WeekDay } from '@/common/enums/group-schedule.enum';

export class ScheduleDayDto {
  @ApiProperty({ enum: WeekDay })
  @IsEnum(WeekDay)
  day: WeekDay;

  @ApiProperty({ example: '14:30' })
  @IsNotEmpty()
  @IsString()
  startTime: string;
}
