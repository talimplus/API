import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';
import { ExpenseResponseDto } from '@/modules/expenses/dto/expense-response.dto';

export class PaginatedExpenseResponseDto {
  @ApiProperty({ type: [ExpenseResponseDto] })
  data: ExpenseResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

