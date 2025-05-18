import { ApiProperty } from '@nestjs/swagger';
import { GroupResponseDto } from './group-response.dto';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';

export class PaginatedGroupResponseDto {
  @ApiProperty({ type: [GroupResponseDto] })
  data: GroupResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
