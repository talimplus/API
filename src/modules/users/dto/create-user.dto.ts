import {
  IsEnum,
  MinLength,
  IsNumber,
  IsOptional,
  IsNotEmpty,
  IsString,
} from 'class-validator';
import { Column } from 'typeorm';
import { UserRole } from '@/common/enums/user-role.enums';

export class CreateUserDto {
  @IsNotEmpty()
  firstName: string;

  @IsNotEmpty()
  lastName: string;

  @IsNotEmpty()
  @IsString()
  @Column({ unique: true })
  login: string;

  @IsNotEmpty()
  phone: string;

  @MinLength(6)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsNumber()
  centerId: number;

  @IsOptional()
  @IsNumber()
  salary?: number;

  @IsOptional()
  @IsNumber()
  commissionPercentage?: number;
}
