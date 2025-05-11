import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSubjectDto {
  @ApiProperty({
    example: 'Frontend',
    description: 'Fan nomi',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: 12,
    description: 'Center idsi',
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;
}
