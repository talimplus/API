import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  Max,
  Min,
} from 'class-validator';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStudentDto {
  @ApiProperty({ example: 'Ali' })
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Valiyev' })
  @IsNotEmpty()
  @IsString()
  lastName: string;

  @ApiProperty({ example: '998001234567' })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({ example: '2006-05-12' })
  @IsString()
  birthDate: number;

  @ApiProperty({
    example: 3,
    description: "Taklif ilgan o'quvchi idsi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  referrerId?: number;

  @ApiProperty({
    example: 400000,
    description: "Oylik to'lovi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  monthlyFee?: number;

  @ApiProperty({
    example: 10,
    description: 'Universal discount percent (0..100)',
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiProperty({
    example: 'Referral discount',
    description: 'Discount reason (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  discountReason?: string;

  @ApiProperty({ example: StudentStatus.NEW, required: false })
  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsNumber()
  userId?: number;

  @ApiProperty({
    example: 2,
    description:
      "O'quvchi qo'shilayotgan center idsi, bu maydon faqatgin admin yangi o'quvchi qo'shayotgan bo'lsa tanlanadi va yuboriladi",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @ApiProperty({
    example: [2],
    description: "O'quvchi biriktirilayotgan guruh IDlari",
    required: false,
    type: [Number],
  })
  groupIds?: number[];
}
