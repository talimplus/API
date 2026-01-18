import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateStudentDiscountPeriodDto } from '@/modules/students/dto/create-student-discount-period.dto';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';
import { IsDateString } from 'class-validator';

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

  @ApiProperty({
    example: '998901234567',
    required: false,
    description: 'Additional phone number (optional)',
  })
  @IsOptional()
  @IsString()
  secondPhone?: string;

  @ApiProperty({ example: '2006-05-12', required: false })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiProperty({
    example: "O'quvchi haqida izoh",
    required: false,
    description: 'Internal comment (optional)',
  })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiProperty({
    example: 'Instagram',
    required: false,
    description: "O'quv markazi haqida qayerdan eshitgani (optional)",
  })
  @IsOptional()
  @IsString()
  heardAboutUs?: string;

  @ApiProperty({
    enum: StudentPreferredTime,
    required: false,
    description: "Qaysi vaqtda o'qimoqchi (ertalab/kechqurun)",
  })
  @IsOptional()
  @IsEnum(StudentPreferredTime)
  preferredTime?: StudentPreferredTime;

  @ApiProperty({
    enum: WeekDay,
    isArray: true,
    required: false,
    description: "Qaysi kunlari o'qimoqchi (hafta kunlari)",
  })
  @IsOptional()
  @IsArray()
  @IsEnum(WeekDay, { each: true })
  preferredDays?: WeekDay[];

  @ApiProperty({
    example: 'AA',
    required: false,
    description: 'Passport series (optional)',
  })
  @IsOptional()
  @IsString()
  passportSeries?: string;

  @ApiProperty({
    example: '1234567',
    required: false,
    description: 'Passport number (optional)',
  })
  @IsOptional()
  @IsString()
  passportNumber?: string;

  @ApiProperty({
    example: '12345678901234',
    required: false,
    description: 'JSHSHIR (optional)',
  })
  @IsOptional()
  @IsString()
  jshshir?: string;

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

  @ApiProperty({
    required: false,
    description:
      'Optional month-based discount periods. If provided, they will override discountPercent for matching months.',
    type: [CreateStudentDiscountPeriodDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStudentDiscountPeriodDto)
  discountPeriods?: CreateStudentDiscountPeriodDto[];

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
