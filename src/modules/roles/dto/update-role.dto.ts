import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import { UserRole } from '@/common/enums/user-role.enums';
import {
  ASSIGNABLE_BASE_ROLES,
  KnownPermissionsConstraint,
} from './create-role.dto';

export class UpdateRoleDto {
  @ApiProperty({ required: false, example: 'Bosh kassir' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiProperty({
    required: false,
    enum: ASSIGNABLE_BASE_ROLES,
    description: 'Tizim rollarida o‘zgartirib bo‘lmaydi',
  })
  @IsOptional()
  @IsEnum(UserRole)
  baseRole?: UserRole;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['payments.view'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Validate(KnownPermissionsConstraint)
  permissions?: string[];
}
