import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSubjectDto {
  @ApiProperty({
    example: 'Frontend',
    description: 'Fan nomi',
  })
  @IsNotEmpty()
  @IsString()
  name: string;
}
