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
    description:
      'Whether this center is the default center for its organization',
  })
  isDefault: boolean;

  @ApiProperty({ example: 'Asia/Tashkent' })
  timezone: string;

  @ApiProperty({ example: 41.311081, nullable: true })
  latitude: number | null;

  @ApiProperty({ example: 69.240562, nullable: true })
  longitude: number | null;

  @ApiProperty({ example: 150 })
  checkInRadiusMeters: number;

  @ApiProperty({
    example: '84.54.72.10',
    nullable: true,
    description: 'Markaz Wi-Fi’sining tashqi IP manzili (xodim davomati uchun)',
  })
  publicIp: string | null;
}
