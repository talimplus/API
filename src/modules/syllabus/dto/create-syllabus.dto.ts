import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSyllabusDto {
  @ApiProperty({
    example: 'Frontend dasturlash — asosiy kurs',
    description: 'Kurs rejasi nomi',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: 'HTML, CSS va JavaScript asoslari',
    description: 'Qisqacha tavsif',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 3,
    description: 'Fan idsi (kurs rejasi markazi fandan olinadi)',
  })
  @IsNotEmpty()
  @IsNumber()
  subjectId: number;
}
