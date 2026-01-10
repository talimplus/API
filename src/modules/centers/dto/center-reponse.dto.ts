import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CenterResponseDto {
  @ApiProperty({
    example: 1,
    description: "Center id'si",
  })
  @IsNotEmpty()
  id: number;

  @ApiProperty({
    example: "O'quv markazi",
    description: "O'quv markazining nomi",
  })
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: true,
    description: 'Whether this center is the default center for its organization',
  })
  isDefault: boolean;
}
