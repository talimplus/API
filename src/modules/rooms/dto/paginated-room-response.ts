import { ApiProperty } from '@nestjs/swagger';
import { RoomResponseDto } from './room-response.dto';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';

export class PaginatedRoomResponseDto {
  @ApiProperty({ type: [RoomResponseDto] })
  data: RoomResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
