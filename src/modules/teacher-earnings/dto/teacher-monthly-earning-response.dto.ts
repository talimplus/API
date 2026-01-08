import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '@/modules/users/dto/user-response.dto';

export class TeacherMonthlyEarningResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 12 })
  teacherId: number;

  @ApiProperty({ example: '2025-12-01' })
  forMonth: string;

  @ApiProperty({ example: 1000000 })
  baseSalarySnapshot: number;

  @ApiProperty({ example: 250000 })
  commissionAmount: number;

  @ApiProperty({ example: 0 })
  carryOverCommission: number;

  @ApiProperty({ example: 1250000 })
  totalEarning: number;

  @ApiProperty({ example: '2026-01-10T10:00:00.000Z' })
  calculatedAt: string;

  @ApiProperty({ type: () => UserResponseDto })
  teacher: UserResponseDto;
}

