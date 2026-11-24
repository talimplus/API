import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateStudentDiscountPeriodDto } from '@/modules/students/dto/create-student-discount-period.dto';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { BaseDiscountDto } from './base-discount.dto';
import { GroupFeeDto } from '@/modules/students/dto/group-fee.dto';
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
    type: [GroupFeeDto],
    required: false,
    description:
      'Har bir guruhdagi shaxsiy narx (0 — guruh narxi). Faqat `students.personalFee` ' +
      "ruxsati bilan o'zgaradi. Ro'yxatda yo'q guruh tegilmaydi. Eski `monthlyFee` " +
      'berilsa (eski front) — barcha guruhlarga bir xil.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupFeeDto)
  groupFees?: GroupFeeDto[];

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
    example: 20000,
    description:
      "Permanent fixed discount per month (so'm) — the amount counterpart of discountPercent. Full months only.",
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

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
    type: [BaseDiscountDto],
    description:
      "Doimiy chegirmalar guruh bo'yicha — TO'LIQ ro'yxat: yo'q guruh chegirmasi " +
      "olib tashlanadi. Berilsa `discountPercent/Amount/Reason` e'tiborga olinmaydi. " +
      "Har guruhga (va 'barcha guruhlar'ga) bittadan.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BaseDiscountDto)
  baseDiscounts?: BaseDiscountDto[];

  @ApiProperty({
    example: 1,
    description:
      "Birinchi N oy tekin (0 — yo'q). O'quvchining birinchi darsi sanasidan N kalendar oy to'lov olinmaydi (17-okt + 1 oy → 17-noyabrgacha)",
    required: false,
    minimum: 0,
    maximum: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  freeMonths?: number;

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

  @ApiProperty({
    example: 1,
    description: "O'quvchi fan IDsi (optional)",
    required: false,
  })
  @IsOptional()
  @IsNumber()
  subjectId?: number | null;

  @ApiProperty({
    example: [1, 2, 5],
    description:
      "O'quvchining fanlari (cheklanmagan). Berilsa `subjectId` dan ustun turadi; birinchisi `subjectId` ga yoziladi. [] — barcha fanlarni olib tashlash",
    required: false,
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  subjectIds?: number[];
}
