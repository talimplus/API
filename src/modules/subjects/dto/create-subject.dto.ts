import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSubjectDto {
  @ApiProperty({
    example: 'Frontend',
    description: 'Fan nomi',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: 12,
    description: 'Center idsi, faqat admin uchun',
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;
}
