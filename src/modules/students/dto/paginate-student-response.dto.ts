import { ApiProperty } from '@nestjs/swagger';
import { StudentResponseDto } from './student-response.dto';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';

export class PaginatedStudentResponseDto {
  @ApiProperty({ type: [StudentResponseDto] })
  data: StudentResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
