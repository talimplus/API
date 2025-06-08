import { ApiProperty } from '@nestjs/swagger';
import { StudentStatus } from '@/common/enums/students-status.enums';

export class StudentResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Ali' })
  firstName: string;

  @ApiProperty({ example: 'Valiyev' })
  lastName: string;

  @ApiProperty({ example: '998001234567' })
  phone: string;

  @ApiProperty({ example: '2006-05-12' })
  birthDate: string;

  @ApiProperty({ example: 400000 })
  monthlyFee: number;

  @ApiProperty({ example: 10, default: 0 })
  referralDiscount: number;

  @ApiProperty({ enum: StudentStatus, example: StudentStatus.NEW })
  status: StudentStatus;
}
