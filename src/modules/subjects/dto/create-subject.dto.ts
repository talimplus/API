import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
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
    description: 'Center idsi',
  })
  @IsNotEmpty()
  @IsNumber()
  centerId: number;
}
