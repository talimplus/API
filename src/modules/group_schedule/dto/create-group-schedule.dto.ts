import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WeekDay } from '@/common/enums/group-schedule.enum';

class GroupScheduleDayDto {
  @ApiProperty({ enum: WeekDay })
  @IsEnum(WeekDay)
  day: WeekDay;

  @ApiProperty({ example: '14:30' })
  @IsNotEmpty()
  @IsString()
  startTime: string;
}

export class CreateGroupScheduleDto {
  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  @IsNumber()
  groupId: number;

  @ApiProperty({ type: [GroupScheduleDayDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupScheduleDayDto)
  days: GroupScheduleDayDto[];
}
