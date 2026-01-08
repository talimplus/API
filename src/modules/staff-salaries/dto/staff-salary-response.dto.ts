import { ApiProperty } from '@nestjs/swagger';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';
import { UserResponseDto } from '@/modules/users/dto/user-response.dto';

export class StaffSalaryResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 10 })
  userId: number;

  @ApiProperty({ example: '2026-01-01', description: 'First day of month (DATE)' })
  forMonth: string;

  @ApiProperty({ example: 1000000 })
  baseSalary: number;

  @ApiProperty({ example: 400000 })
  paidAmount: number;

  @ApiProperty({ enum: StaffSalaryStatus, example: StaffSalaryStatus.PARTIAL })
  status: StaffSalaryStatus;

  @ApiProperty({ example: '2026-01-15T10:00:00.000Z', required: false, nullable: true })
  paidAt?: string | null;

  @ApiProperty({ example: 'Paid cash', required: false, nullable: true })
  comment?: string | null;

  @ApiProperty({ example: '2026-01-01T09:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ type: () => UserResponseDto })
  user: UserResponseDto;
}

