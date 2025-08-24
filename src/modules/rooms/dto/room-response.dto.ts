import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RoomResponseDto {
  @ApiProperty({
    example: 1,
    description: "Xona id'si",
  })
  @IsNotEmpty()
  id: number;

  @ApiProperty({
    example: '3-xona',
    description: 'Xona nomi',
  })
  @IsNotEmpty()
  name: string;
}
