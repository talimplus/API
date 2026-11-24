import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Matches } from 'class-validator';

/** Bitta o'quvchining bitta darsdagi belgisini olib tashlash. */
export class ClearAttendanceDto {
  @ApiProperty({ example: '2026-11-24', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "lessonDate YYYY-MM-DD bo'lishi kerak",
  })
  lessonDate: string;

  @ApiProperty({ example: 15 })
  @IsInt()
  studentId: number;
}
