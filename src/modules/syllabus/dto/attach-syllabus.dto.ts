import { IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AttachSyllabusDto {
  @ApiProperty({
    example: 4,
    description: 'Guruhga biriktiriladigan kurs rejasi idsi (null — uzish)',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  syllabusId?: number | null;
}
