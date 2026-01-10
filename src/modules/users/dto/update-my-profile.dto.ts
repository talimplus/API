import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateMyProfileDto {
  @ApiPropertyOptional({ example: 'Ali' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Valiyev' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: 'Ali12345' })
  @IsOptional()
  @IsString()
  login?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'NewStrongPass123' })
  @IsOptional()
  @MinLength(6)
  password?: string;
}

