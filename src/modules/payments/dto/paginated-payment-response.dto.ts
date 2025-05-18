import { ApiProperty } from '@nestjs/swagger';
import { PaymentResponseDto } from './payment-reponse.dto';
import { PaginationMetaDto } from '@/common/dto/pagination-meta.dto';

export class PaginatedPaymentResponseDto {
  @ApiProperty({ type: [PaymentResponseDto] })
  data: PaymentResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
