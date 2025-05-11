import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
} from 'class-validator';
import { StudentStatus } from '@/common/enums/students-status.enums';

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

  @IsEnum(StudentStatus)
  status: StudentStatus;

  @IsNumber()
  centerId: number;

  @IsOptional()
  @IsNumber()
  groupId?: number;
}
