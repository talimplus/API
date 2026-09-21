import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Logo uchun ~400 KB data URL (≈300 KB rasm), favicon uchun ~150 KB */
export const MAX_LOGO_LENGTH = 400_000;
export const MAX_FAVICON_LENGTH = 150_000;

const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
];

/**
 * Rasm maydoni: `data:image/<turi>;base64,...` yoki `https://...` havolasi.
 * Bo'sh satr — rasmni olib tashlash (null bilan bir xil).
 */
@ValidatorConstraint({ name: 'imageUrlOrDataUrl', async: false })
export class IsImageUrlOrDataUrl implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value !== 'string') return false;

    if (value.startsWith('data:')) {
      const match = /^data:([a-z0-9.+/-]+);base64,/i.exec(value);
      if (!match) return false;
      return ALLOWED_IMAGE_TYPES.includes(match[1].toLowerCase());
    }
    return /^https:\/\/\S+$/i.test(value);
  }

  defaultMessage(): string {
    return (
      "Rasm PNG, JPEG, WEBP, SVG yoki ICO bo'lishi kerak " +
      '(data URL yoki https:// havolasi)'
    );
  }
}

export class UpdateBrandingDto {
  @ApiPropertyOptional({
    description: "O'quv markazi nomi — kabinet sarlavhasida ko'rinadi",
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Logotip: data URL yoki https havolasi. Bo‘sh satr — olib tashlash',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LOGO_LENGTH, {
    message: 'Logo hajmi juda katta (taxminan 300 KB gacha bo‘lsin)',
  })
  @Validate(IsImageUrlOrDataUrl)
  logoUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'Favicon: data URL yoki https havolasi. Bo‘sh satr — olib tashlash',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FAVICON_LENGTH, {
    message: 'Favicon hajmi juda katta (taxminan 100 KB gacha bo‘lsin)',
  })
  @Validate(IsImageUrlOrDataUrl)
  faviconUrl?: string | null;
}
