import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AiPlanChatMessageDto {
  @ApiProperty({
    enum: ['user', 'assistant'],
    example: 'user',
    description: 'Xabar kimdan: foydalanuvchi yoki AI',
  })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({
    example: "Menga frontend yo'nalishda 4 oylik reja tuzib ber",
    description: 'Xabar matni',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(4000)
  content: string;
}

export class AiPlanChatDto {
  @ApiProperty({
    example: 3,
    description:
      'Fan idsi (ixtiyoriy — berilsa AI fan nomini kontekst sifatida oladi)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  subjectId?: number;

  @ApiProperty({
    type: [AiPlanChatMessageDto],
    description:
      "Suhbatning to'liq tarixi (eski xabarlar birinchi). Oxirgi xabar foydalanuvchidan bo'lishi kerak",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => AiPlanChatMessageDto)
  messages: AiPlanChatMessageDto[];
}
