import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';

export class PaySalaryDeductionDto {
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

  @ApiProperty({ example: 'Sentabrda 3 marta kechikdi' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason: string;

  @ApiProperty({ enum: StaffDeductionType, required: false })
  @IsOptional()
  @IsEnum(StaffDeductionType)
  type?: StaffDeductionType;
}

export class PayStaffSalaryDto {
  @ApiProperty({
    example: 200000,
    description:
      'Qo‘lga beriladigan summa. Faqat jarima yozmoqchi bo‘lsangiz 0 yuboring.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ required: false, example: 'Naqd berildi' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiProperty({
    required: false,
    type: PaySalaryDeductionDto,
    description:
      'Shu to‘lov bilan birga yoziladigan jarima (kechikish, topshirilmagan pul va h.k.). ' +
      'Avval ushlab qolinadi, keyin qolgan summadan to‘lov amalga oshiriladi.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaySalaryDeductionDto)
  deduction?: PaySalaryDeductionDto;
}
