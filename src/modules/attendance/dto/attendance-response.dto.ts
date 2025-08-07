import { ApiProperty } from '@nestjs/swagger';
import { StudentResponseDto } from '@/modules/students/dto/student-response.dto';

export class AttendanceResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '2025-08-06' })
  date: string;

  @ApiProperty({ example: true })
  isPresent: boolean;

  @ApiProperty({ example: 'Kasal', required: false })
  reason?: string;

  @ApiProperty({ type: () => StudentResponseDto })
  student: StudentResponseDto;
}
