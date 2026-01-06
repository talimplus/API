import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '@/modules/users/dto/user-response.dto';
import { SubjectResponseDto } from '@/modules/subjects/dto/subject-response.dto';
import { CenterResponseDto } from '@/modules/centers/dto/center-reponse.dto';
import { RoomResponseDto } from '@/modules/rooms/dto/room-response.dto';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';
import { ScheduleDayDto } from '@/modules/group_schedule/dto/schedule-day.dto';

export class GroupResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Ingliz tili guruh 1' })
  name: string;

  @ApiProperty({ example: 'Asia/Tashkent' })
  timezone: string;

  @ApiProperty({ example: '2026-01-01' })
  startDate: string;

  @ApiProperty({ example: '2026-06-01', required: false, nullable: true })
  endDate?: string | null;

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ApiProperty({ example: 400000 })
  monthlyFee: number;

  @ApiProperty({ type: () => SubjectResponseDto, nullable: true })
  subject: SubjectResponseDto;

  @ApiProperty({ type: () => UserResponseDto, nullable: true })
  teacher: UserResponseDto;

  @ApiProperty({ type: () => CenterResponseDto, nullable: true })
  center: CenterResponseDto;

  @ApiProperty({ type: () => RoomResponseDto, nullable: true })
  room: RoomResponseDto;

  @ApiProperty({
    type: [ScheduleDayDto],
    required: false,
    description: 'Gurux schedule (kun + boshlanish vaqti)',
    example: [
      { day: 'monday', startTime: '14:30' },
      { day: 'wednesday', startTime: '14:30' },
    ],
  })
  schedules?: ScheduleDayDto[];
}
