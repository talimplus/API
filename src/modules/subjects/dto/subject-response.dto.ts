import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubjectResponseDto {
  @ApiProperty({
    example: 1,
    description: "Fan id'si",
  })
  @IsNotEmpty()
  id: number;

  @ApiProperty({
    example: 'Frontend',
    description: 'Fan nomi',
  })
  @IsNotEmpty()
  name: string;
}
