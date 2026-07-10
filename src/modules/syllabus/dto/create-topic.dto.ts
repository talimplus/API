import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TopicDifficulty } from '../enums/topic-difficulty.enum';

export class CreateTopicDto {
  @ApiProperty({ example: 'CSS Flexbox', description: 'Mavzu nomi' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({
    example: 'Flexbox bilan moslashuvchan layout qurish',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: TopicDifficulty,
    example: TopicDifficulty.MEDIUM,
    required: false,
  })
  @IsOptional()
  @IsEnum(TopicDifficulty)
  difficulty?: TopicDifficulty;

  @ApiProperty({
    example: 2,
    description: 'Mavzu odatda nechta dars egallaydi',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedLessons?: number;

  @ApiProperty({
    description: "O'qituvchi uchun qo'llanma (markdown)",
    required: false,
  })
  @IsOptional()
  @IsString()
  guide?: string;

  @ApiProperty({
    description: "Darsda nimalar o'tilishi rejasi (markdown)",
    required: false,
  })
  @IsOptional()
  @IsString()
  lessonOutline?: string;

  @ApiProperty({ description: 'Uyga vazifa (markdown)', required: false })
  @IsOptional()
  @IsString()
  homework?: string;
}
