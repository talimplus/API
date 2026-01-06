import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceStatus } from '@/modules/attendance/enums/attendance-status.enum';
import { StudentResponseDto } from '@/modules/students/dto/student-response.dto';

export class AttendanceRowDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 10 })
  groupId: number;

  @ApiProperty({ example: 123 })
  studentId: number;

  @ApiProperty({ example: '2026-01-06' })
  lessonDate: string;

  @ApiProperty({ enum: AttendanceStatus, example: AttendanceStatus.PRESENT })
  status: AttendanceStatus;

  @ApiPropertyOptional({ example: 'Was sick' })
  comment?: string | null;

  @ApiPropertyOptional({ example: 55, description: 'User id who submitted.' })
  submittedById?: number | null;

  @ApiProperty({ example: '2026-01-06T12:34:56.000Z' })
  submittedAt: string;

  @ApiProperty({ example: '2026-01-06T12:34:56.000Z' })
  updatedAt: string;

  @ApiPropertyOptional({ type: () => StudentResponseDto })
  student?: StudentResponseDto;
}


