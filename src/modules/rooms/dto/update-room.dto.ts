import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRoomDto {
  @ApiProperty({
    example: '3-xona',
    description: 'Xona nomi',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: 12,
    description: 'Center idsi',
  })
  @IsOptional()
  @IsNumber()
  centerId?: number;
}
