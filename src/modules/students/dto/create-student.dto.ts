import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
  MinLength,
} from 'class-validator';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { Column } from 'typeorm';

export class CreateStudentDto {
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsNotEmpty()
  @IsString()
  lastName: string;

  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsString()
  birthDate: number;

  @IsNotEmpty()
  @IsString()
  @Column({ unique: true })
  login: string;

  @MinLength(6)
  password: string;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsNumber()
  centerId?: number;

  @IsOptional()
  @IsNumber()
  groupId?: number;
}
