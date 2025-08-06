import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ScheduleDayDto } from '@/modules/group_schedule/dto/schedule-day.dto';

export class UpdateGroupScheduleDto {
  @ApiProperty({
    example: [
      { day: 'monday', startTime: '14:00' },
      { day: 'wednesday', startTime: '14:00' },
      { day: 'friday', startTime: '14:00' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days: ScheduleDayDto[];
}
