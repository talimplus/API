import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateTopicContentDto {
  @ApiProperty({
    example: '10-11 sinf o\'quvchilari',
    description: 'Auditoriya (yosh, daraja)',
    required: false,
  })
  @IsOptional()
  @IsString()
  audience?: string;

  @ApiProperty({
    example: "Amaliy mashqlarga ko'proq urg'u ber",
    description: "AI uchun qo'shimcha ko'rsatmalar",
    required: false,
  })
  @IsOptional()
  @IsString()
  instructions?: string;
}
