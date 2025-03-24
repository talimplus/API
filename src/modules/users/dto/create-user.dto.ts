import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  MinLength,
  IsNumber,
  IsOptional,
} from 'class-validator';
import { UserRole } from '@/common/enums/user-role.enums';

export class CreateUserDto {
  @IsNotEmpty()
  firstName: string;

  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  email: string;

  @IsNotEmpty()
  phone: string;

  @MinLength(6)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsNumber()
  centerId?: number;

  @IsOptional()
  @IsNumber()
  salary?: number;

  @IsOptional()
  @IsNumber()
  commissionPercentage?: number;
}
