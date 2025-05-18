import { PartialType } from '@nestjs/mapped-types';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Column } from 'typeorm';
import { StudentStatus } from '@/common/enums/students-status.enums';

export class UpdateStudentDto extends PartialType(CreateStudentDto) {
  @ApiProperty({ example: 'Ali', required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ example: 'Valiyev', required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ example: '998001234567', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: '2006-05-12', required: false })
  @IsOptional()
  @IsString()
  birthDate?: number;

  @ApiProperty({ example: 'Ali12345', required: false })
  @IsOptional()
  @IsString()
  @Column({ unique: true })
  login?: string;

  @ApiProperty({
    example: 3,
    description: "Taklif ilgan o'quvchi idsi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  referrerId?: number;

  @ApiProperty({
    example: 400000,
    description: "Oylik to'lovi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  monthlyFee?: number;

  @ApiProperty({ example: 'Ali12345', required: false })
  @IsOptional()
  @MinLength(6)
  password?: string;

  @ApiProperty({ example: StudentStatus.NEW, required: false })
  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsNumber()
  userId?: number;

  @ApiProperty({
    example: 2,
    description:
      "O'quvchi qo'shilayotgan center idsi, bu maydon faqatgin admin yangi o'quvchi qo'shayotgan bo'lsa tanlanadi va yuboriladi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;

  @ApiProperty({
    example: 2,
    description: "O'quvchi biriktirilayotgan gurux idsi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  groupIds?: number[];
}
