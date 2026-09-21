import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';

export class CreateStaffDeductionDto {
  @ApiProperty({ example: 12, description: 'Xodim (user) id’si' })
  @Type(() => Number)
  @IsInt()
  userId: number;

  @ApiProperty({
    example: 150000,
    description:
      'Ushlab qolinadigan summa. Oylikdan katta bo‘lishi mumkin — ' +
      'sig‘magani keyingi oyliklardan ushlanadi.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({
    example: '2026-09',
    required: false,
    description: 'Qaysi oy oyligiga yoziladi (YYYY-MM). Default — joriy oy.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'forMonth YYYY-MM ko‘rinishida bo‘lishi kerak',
  })
  forMonth?: string;

  @ApiProperty({
    enum: StaffDeductionType,
    required: false,
    description: 'Sabab turi (faqat guruhlash uchun)',
  })
  @IsOptional()
  @IsEnum(StaffDeductionType)
  type?: StaffDeductionType;

  @ApiProperty({
    example: 'Sentabr oyida 3 marta kechikdi',
    description: 'Sabab — majburiy, chunki xodim buni o‘z sahifasida ko‘radi',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason: string;
}
