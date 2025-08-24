import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty({
    example: '3-xona',
    description: 'Xona nomi',
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
