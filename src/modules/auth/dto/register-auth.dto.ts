import { IsEmail, IsNotEmpty, MinLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class RegisterAuthDto {
  @ApiProperty({ example: 'Organization' })
  @IsNotEmpty()
  organizationName: string;

  @ApiProperty({ example: 'organization@gmail.com', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'organization@gmail.com', required: false })
  @Transform(({ obj, value }) => {
    // If email is provided, use it for login; otherwise use login value
    return obj.email || value || undefined;
  })
  @IsOptional()
  @IsEmail()
  login?: string;

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
