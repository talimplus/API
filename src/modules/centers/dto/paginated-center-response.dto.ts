import { ApiProperty } from '@nestjs/swagger';
import { CenterResponseDto } from './center-reponse.dto';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';

export class PaginatedCenterResponseDto {
  @ApiProperty({ type: [CenterResponseDto] })
  data: CenterResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
