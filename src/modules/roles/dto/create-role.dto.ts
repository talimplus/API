import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { UserRole } from '@/common/enums/user-role.enums';
import {
  ALL_PERMISSIONS,
  isKnownPermission,
} from '@/common/permissions/permission.catalog';

/** Rolga faqat katalogdagi kalitlarni berish mumkin (`*` — faqat admin roliga). */
@ValidatorConstraint({ name: 'KnownPermissions', async: false })
export class KnownPermissionsConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.every(
      (key) =>
        typeof key === 'string' &&
        key !== ALL_PERMISSIONS &&
        isKnownPermission(key),
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const value = args.value as unknown[];
    const unknown = Array.isArray(value)
      ? value.filter(
          (key) =>
            typeof key !== 'string' ||
            key === ALL_PERMISSIONS ||
            !isKnownPermission(key),
        )
      : [];
    return `Noma'lum ruxsat kaliti: ${unknown.join(', ')}`;
  }
}

/** Rol yaratishda tanlash mumkin bo'lgan turlar (admin/super_admin — mumkin emas). */
export const ASSIGNABLE_BASE_ROLES = [
  UserRole.TEACHER,
  UserRole.MANAGER,
  UserRole.RECEPTION,
  UserRole.OTHER,
];

export class CreateRoleDto {
  @ApiProperty({ example: 'Kassir', description: 'UI da ko‘rinadigan nom' })
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiProperty({
    enum: ASSIGNABLE_BASE_ROLES,
    example: UserRole.OTHER,
    description:
      'Rol turi. Ruxsatlarga ta’sir qilmaydi, lekin biznes-mantiq uchun kerak: ' +
      '`teacher` guruhga biriktiriladi va foiz oladi.',
  })
  @IsEnum(UserRole)
  baseRole: UserRole;

  @ApiProperty({
    type: [String],
    example: ['payments.view', 'payments.create'],
    description: 'Ruxsat kalitlari (GET /roles/permissions dan olinadi)',
  })
  @IsArray()
  @ArrayUnique()
  @Validate(KnownPermissionsConstraint)
  permissions: string[];

  @ApiProperty({
    required: false,
    example: 'kassir',
    description: 'Ixtiyoriy slug. Berilmasa `name` dan hosil qilinadi.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  key?: string;
}
