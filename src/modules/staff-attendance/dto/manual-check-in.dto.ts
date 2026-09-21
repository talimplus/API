import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Admin/qabulxona xodim o'rniga davomat yozadi (telefoni o'chgan, internet
 * yo'q, kech eslagan va h.k.). Bunday yozuvning manbasi `manual` bo'ladi va
 * hisobotda shunday ko'rinadi — tekshirib bo'lmagani yashirilmaydi.
 */
export class ManualCheckInDto {
  @ApiProperty({ example: 12, description: "Xodim (user) id'si" })
  @Type(() => Number)
  @IsInt()
  userId: number;

  @ApiProperty({ example: '2026-09-21', description: 'Ish kuni, YYYY-MM-DD' })
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Sana YYYY-MM-DD ko‘rinishida bo‘lishi kerak',
  })
  workDate: string;

  @ApiProperty({
    example: '09:05',
    description: 'Kelgan vaqti (markaz timezone’ida), HH:mm',
  })
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'Vaqt HH:mm ko‘rinishida bo‘lishi kerak',
  })
  checkInTime: string;

  @ApiProperty({
    example: 'Telefoni o‘chib qolgan, qabulxona tasdiqladi',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
