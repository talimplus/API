import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class TransferLeadToStudentDto {
  @ApiProperty({ example: 'Ali', description: 'Required on transfer' })
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Valiyev', description: 'Required on transfer' })
  @IsNotEmpty()
  @IsString()
  lastName: string;

  @ApiProperty({ example: '2006-05-12', description: 'Required on transfer' })
  @IsNotEmpty()
  @IsString()
  birthDate: string;

  @ApiProperty({
    example: [7],
    description: 'Required: groupIds for new student',
    type: [Number],
  })
  @IsArray()
  @IsNumber({}, { each: true })
  groupIds: number[];

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyFee?: number;

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discountPercent?: number;

  @ApiProperty({ example: 'Manual discount', required: false })
  @IsOptional()
  @IsString()
  discountReason?: string;
}

