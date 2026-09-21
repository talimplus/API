import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCenterDto {
  @ApiProperty({
    example: "O'quv markazi",
    description: "O'quv markazining nomi",
  })
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: true,
    required: false,
    description:
      'If true, this center becomes the default for the organization (only one default center is allowed).',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 'true' || value === 1 || value === '1')
      return true;
    if (value === false || value === 'false' || value === 0 || value === '0')
      return false;
    return value;
  })
  @IsBoolean()
  isDefault?: boolean;

  // ── Xodim davomati sozlamalari ─────────────────────────────

  @ApiProperty({
    example: 41.311081,
    required: false,
    description:
      'Markaz binosining kengligi (xaritadan belgilanadi). null — tozalash',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsLatitude()
  latitude?: number | null;

  @ApiProperty({ example: 69.240562, required: false })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsLongitude()
  longitude?: number | null;

  @ApiProperty({
    example: 150,
    required: false,
    description:
      'Shu radius (metr) ichidan bosilgan “Keldim” joylashuv bo‘yicha to‘g‘ri hisoblanadi',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(5000)
  checkInRadiusMeters?: number;

  @ApiProperty({
    example: '84.54.72.10',
    required: false,
    description:
      'Markaz Wi-Fi’sining tashqi IP manzili. Odatda qo‘lda yozilmaydi — ' +
      '`POST /centers/:id/capture-ip` markazdan turib avtomatik yozadi. null — tozalash',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  publicIp?: string | null;

  @ApiProperty({
    example: 'Asia/Tashkent',
    required: false,
    description:
      'Markaz timezone’i — “bugun” va ish kuni shunga qarab aniqlanadi',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
