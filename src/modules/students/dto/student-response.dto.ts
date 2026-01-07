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

  @ApiProperty({ example: 10, default: 0, description: 'Universal discount %' })
  discountPercent: number;

  @ApiProperty({
    example: 'Referral discount',
    required: false,
    nullable: true,
  })
  discountReason?: string | null;

  @ApiProperty({ enum: StudentStatus, example: StudentStatus.NEW })
  status: StudentStatus;

  @ApiProperty({
    example: '2026-01-01T10:00:00.000Z',
    required: false,
    nullable: true,
    description: 'When student became ACTIVE (nullable).',
  })
  activatedAt?: string | null;
}
