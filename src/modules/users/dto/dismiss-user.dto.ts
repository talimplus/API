import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** `PUT /users/:id/dismiss` — xodimni ishdan bo'shatish. */
export class DismissUserDto {
  @ApiProperty({
    required: false,
    example: '2026-11-13',
    description:
      "Oxirgi ish kuni (YYYY-MM-DD, inclusive). Bo'lmasa — bugun. Kelajak bo'lolmaydi.",
  })
  @IsOptional()
  @IsDateString({}, { message: "Sana noto'g'ri" })
  dismissedAt?: string;

  @ApiProperty({ required: false, example: "O'z xohishi bilan" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
