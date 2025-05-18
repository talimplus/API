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
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    example: 'Ali',
  })
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({
    example: 'Valiyev',
  })
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({
    example: 'Ali12345',
  })
  @IsNotEmpty()
  @IsString()
  @Column({ unique: true })
  login: string;

  @ApiProperty({
    example: '998001234567',
  })
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    example: 'Ali12345',
  })
  @MinLength(6)
  password: string;

  @ApiProperty({
    example: UserRole.TEACHER,
  })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({
    example: 2,
    description: "centerId faqat admin ishchi qo'shayotganda yuborish kerak",
  })
  @IsNumber()
  centerId: number;

  @ApiProperty({
    example: 2000000,
    description: 'Aniq belgilangan oylik',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  salary?: number;

  @ApiProperty({
    example: 40,
    description:
      "Bu asosan yangi o'qituvchi qo'shishda yuboriladi, ya'ni bitta o'quvchidan necha foiz olishini bildiradi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  commissionPercentage?: number;
}
