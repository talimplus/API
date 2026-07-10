import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderTopicsDto {
  @ApiProperty({
    example: [5, 3, 8, 1],
    description: 'Mavzu idlari yangi tartibda',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  topicIds: number[];
}
