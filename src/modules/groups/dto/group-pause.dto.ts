import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateGroupPauseDto {
  @ApiProperty({
    example: '2026-10-05',
    description: 'Birinchi to‘xtatilgan kun (inclusive)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fromDate YYYY-MM-DD bo‘lishi kerak',
  })
  fromDate: string;

  @ApiProperty({
    example: '2026-10-12',
    description: 'Oxirgi to‘xtatilgan kun (inclusive)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'toDate YYYY-MM-DD bo‘lishi kerak',
  })
  toDate: string;

  @ApiProperty({ example: "O'qituvchi kasal", description: 'Sabab (majburiy)' })
  @IsString()
  @IsNotEmpty({ message: 'Sabab majburiy' })
  @MaxLength(500)
  reason: string;
}
