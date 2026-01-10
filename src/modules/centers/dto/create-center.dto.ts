import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCenterDto {
  @ApiProperty({
    example: "O'quv markazi",
    description: "O'quv markazining nomi",
  })
  @IsNotEmpty()
  name: string;

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
}
