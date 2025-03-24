import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterAuthDto {
  @IsNotEmpty()
  organizationName: string;

  @IsEmail()
  email: string;

  @MinLength(6)
  password: string;

  @IsNotEmpty()
  centerName: string;

  @IsNotEmpty()
  firstName: string;

  @IsNotEmpty()
  lastName: string;

  @IsNotEmpty()
  phone: string;
}
