import { ApiProperty } from '@nestjs/swagger';
import { SubjectResponseDto } from './subject-response.dto';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';

export class PaginatedSubjectResponseDto {
  @ApiProperty({ type: [SubjectResponseDto] })
  data: SubjectResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
