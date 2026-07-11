import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TopicDifficulty } from '../enums/topic-difficulty.enum';

export class AiPlanTopicDto {
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
}

export class SaveAiPlanDto {
  @ApiProperty({
    example: 3,
    description: 'Fan idsi (kurs rejasi markazi fandan olinadi)',
  })
  @IsNotEmpty()
  @IsNumber()
  subjectId: number;

  @ApiProperty({
    example: 'Frontend dasturlash — 4 oylik kurs',
    description: 'Kurs rejasi nomi',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: 'HTML, CSS, JavaScript va TypeScript asoslari',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    type: [AiPlanTopicDto],
    description: "Mavzular ro'yxati (berilgan tartibda saqlanadi)",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => AiPlanTopicDto)
  topics: AiPlanTopicDto[];
}
