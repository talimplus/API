import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Column } from 'typeorm';
import { UserRole } from '@/common/enums/user-role.enums';

export class UpdateUserDto {
  @IsOptional()
  @ApiProperty({
    example: 'Ali',
    required: false,
  })
  @IsOptional()
  firstName?: string;

  @IsOptional()
  @ApiProperty({
    example: 'Valiyev',
    required: false,
  })
  @IsOptional()
  lastName?: string;

  @IsOptional()
  @ApiProperty({
    example: 'Ali12345',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Column({ unique: true })
  login?: string;

  @IsOptional()
  @ApiProperty({
    example: '998001234567',
    required: false,
  })
  @IsOptional()
  phone?: string;

  @IsOptional()
  @ApiProperty({
    example: 'Ali12345',
    required: false,
  })
  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @ApiProperty({
    example: UserRole.TEACHER,
    required: false,
  })
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({
    example: 2,
    description: "centerId faqat admin ishchi qo'shayotganda yuborish kerak",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;

  @IsOptional()
  @ApiProperty({
    example: 2000000,
    description: 'Aniq belgilangan oylik',
    required: false,
  })
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
