import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterAuthDto {
  @ApiProperty({ example: 'Organization' })
  @IsNotEmpty()
  organizationName: string;

  @ApiProperty({ example: 'organization@gmail.com' })
  @IsEmail()
  login: string;

  @ApiProperty({ example: 'password123' })
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'Center name' })
  @IsNotEmpty()
  centerName: string;

  @ApiProperty({ example: 'First name' })
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Last name' })
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: '+998901234567' })
  @IsNotEmpty()
  phone: string;
}
