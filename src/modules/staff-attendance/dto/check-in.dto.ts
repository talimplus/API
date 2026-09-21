import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * "Keldim" tugmasi.
 *
 * Barcha maydonlar ixtiyoriy: joylashuvga ruxsat berilmasa ham yozuv
 * yaratiladi, shunchaki `confidence` pasayadi. Hech narsa bloklanmaydi.
 */
export class CheckInDto {
  @ApiProperty({
    example: 41.311081,
    required: false,
    description:
      'Brauzer Geolocation API bergan kenglik. Ruxsat berilmasa yuborilmaydi',
  })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiProperty({ example: 69.240562, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiProperty({
    example: 25,
    required: false,
    description: 'GPS xatolik radiusi (metr) — `position.coords.accuracy`',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  accuracyMeters?: number;

  @ApiProperty({
    example: 'a3f1c0de-55b2-4f3a-9d0e-7c1b2a8e9f10',
    required: false,
    description:
      "Qurilma ID'si — frontda bir marta generatsiya qilinib localStorage'da saqlanadi. " +
      'Bitta telefondan bir necha xodim kirishini aniqlash uchun',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;
}
