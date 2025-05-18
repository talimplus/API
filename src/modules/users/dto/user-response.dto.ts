import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { UserRole } from '@/common/enums/user-role.enums';

export class UserResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Ali' })
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Valiyev' })
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'Ali12345', uniqueItems: true })
  @IsNotEmpty()
  login: string;

  @ApiProperty({ example: '998001234567' })
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'Ali12345' })
  @IsNotEmpty()
  password: string;

  @ApiProperty({ enum: UserRole, example: UserRole.TEACHER })
  role: UserRole;

  @ApiProperty({ example: 2, description: 'Center idsi' })
  centerId: number;

  @ApiProperty({
    example: 2000000,
    description:
      "Agar aniq oylik kelishilsa ya'ni foizga gaplashilmasa oylik qo'shiladi yoki ham foiz ham oylikga gaplashilsaham oylik to'ldirilishi kerak",
  })
  salary: number;

  @ApiProperty({
    example: 40,
    description:
      "Bu maydon asosan o'qituvchi bo'lsa to'ldiriladi, ya'ni bitta o'quvchidan necha foiz olishi kerakligini ko'rsatadi",
  })
  commissionPercentage: number;
}
