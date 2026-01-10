import { ApiProperty } from '@nestjs/swagger';
import { CenterResponseDto } from '@/modules/centers/dto/center-reponse.dto';

export class ExpenseResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 2, nullable: true })
  centerId: number | null;

  @ApiProperty({ example: 'Rent' })
  name: string;

  @ApiProperty({ example: 1500000 })
  amount: number;

  @ApiProperty({ example: 'Office rent for the month', required: false, nullable: true })
  description?: string | null;

  @ApiProperty({ example: '2026-01-01', description: 'Month (DATE, first day of month)' })
  forMonth: string;

  @ApiProperty({ example: '2026-01-08T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ type: () => CenterResponseDto, required: false })
  center?: CenterResponseDto;
}

