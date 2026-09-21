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

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.NEW })
  status: GroupStatus;

  @ApiProperty({
    example: '2026-01-15T10:00:00.000Z',
    required: false,
    nullable: true,
    description: 'When group was marked as STARTED (nullable).',
  })
  startedAt?: string | null;

  @ApiProperty({
    example: 400000,
    description:
      "JORIY oyda amal qilayotgan oylik narx. Narx o'zgartirilganda u " +
      "keyingi oydan kuchga kirgani uchun bu maydon darhol o'zgarmaydi — " +
      "rejalashtirilgan narx `upcomingMonthlyFee` da ko'rinadi.",
  })
  monthlyFee: number;

  @ApiProperty({
    example: 500000,
    required: false,
    nullable: true,
    description:
      "Keyingi oydan kuchga kiradigan yangi narx. Rejalashtirilgan o'zgarish " +
      'bo‘lmasa null.',
  })
  upcomingMonthlyFee?: number | null;

  @ApiProperty({
    example: '2026-10-01',
    required: false,
    nullable: true,
    description:
      '`upcomingMonthlyFee` kuchga kiradigan oy (oyning 1-sanasi). ' +
      "Rejalashtirilgan o'zgarish bo‘lmasa null.",
  })
  upcomingFeeFromMonth?: string | null;

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
