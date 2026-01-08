import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class PayStaffSalaryDto {
  @ApiProperty({ example: 200000, description: 'Payment amount to add' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ required: false, example: 'Paid by bank transfer' })
  @IsOptional()
  @IsString()
  comment?: string;
}

