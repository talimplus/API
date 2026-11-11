import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const MONTH = /^\d{4}-\d{2}$/;

/** POST /staff/advances — xodimga avans berish. */
export class CreateStaffAdvanceDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  userId: number;

  @ApiProperty({ example: 500000, description: 'Hozir berilayotgan summa' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({
    example: '2026-11',
    required: false,
    description:
      'Qaysi oy oyligidan ushlanadi (ish oyi, YYYY-MM). Default — joriy oy. ' +
      "Keyingi oy ham bo'lishi mumkin. Oylikka sig'masa qolgani keyingi oyliklardan.",
  })
  @IsOptional()
  @Matches(MONTH, { message: 'forMonth YYYY-MM ko‘rinishida bo‘lishi kerak' })
  forMonth?: string;

  @ApiProperty({ required: false, example: 'Uy ijarasi uchun' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

/** POST /staff/bonuses — xodimga mukofot (oylikka qo'shiladi). */
export class CreateStaffBonusDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  userId: number;

  @ApiProperty({ example: 300000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({
    example: '2026-11',
    required: false,
    description:
      "Qaysi oy oyligiga qo'shiladi (YYYY-MM, kelajak emas). Default — joriy oy.",
  })
  @IsOptional()
  @Matches(MONTH, { message: 'forMonth YYYY-MM ko‘rinishida bo‘lishi kerak' })
  forMonth?: string;

  @ApiProperty({
    example: "O'quvchilar natijasi uchun",
    description: 'Majburiy — xodim ko‘radi',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason: string;
}
