import { IsArray, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetLessonTopicsDto {
  @ApiProperty({
    example: [3, 7],
    description:
      "Shu darsga biriktiriladigan mavzu idlari (bo'sh massiv — darsdan barcha mavzularni olib tashlash)",
  })
  @IsArray()
  @IsInt({ each: true })
  topicIds: number[];
}
