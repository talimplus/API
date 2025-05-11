import { IsNumber, IsOptional, IsString, IsEnum } from 'class-validator';
import { StudentStatus } from '@/common/enums/students-status.enums';

export class CreateStudentDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  birthDate?: number;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsNumber()
  centerId?: number;

  @IsOptional()
  @IsNumber()
  groupId?: number;
}
