import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';
import { CandidateResponseDto } from '@/modules/candidates/dto/candidate.dto';

export class PaginatedCandidateResponseDto {
  @ApiProperty({ type: [CandidateResponseDto] })
  data: CandidateResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
