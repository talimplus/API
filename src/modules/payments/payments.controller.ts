import { PaginatedPaymentResponseDto } from '@/modules/payments/dto/paginated-payment-response.dto';
import { PaymentResponseDto } from '@/modules/payments/dto/payment-reponse.dto';
import { PaymentStatus } from '@/modules/payments/entities/payment.entity';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}
  @Get()
  @ApiOperation({
    summary: 'Get All Payments',
    description:
      'Ensures missing monthly payments exist for ACTIVE students and their groups (ensurePayments) before returning results.',
  })
  @ApiResponse({ type: PaginatedPaymentResponseDto })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  @ApiQuery({ name: 'status', required: false, enum: PaymentStatus })
  @ApiQuery({
    name: 'forMonth',
    required: false,
    description: 'Filter by month (YYYY-MM)',
    example: '2026-01',
  })
  @ApiQuery({
    name: 'overdueOnly',
    required: false,
    description:
      'If true, returns only overdue payments (today > hardDueDate and not paid)',
    example: 'true',
  })
  @ApiQuery({ name: 'studentId', required: false, type: Number })
  @ApiQuery({ name: 'groupId', required: false, type: Number })
  async findAll(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
    @Query('status') status?: PaymentStatus,
    @Query('forMonth') forMonth?: string, // YYYY-MM
    @Query('overdueOnly') overdueOnly?: string, // 'true' | 'false'
    @Query('studentId') studentId?: number,
    @Query('groupId') groupId?: number,
  ) {
    return this.paymentsService.findAll(req.user.organizationId, {
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
      status,
      forMonth,
      overdueOnly: overdueOnly === 'true',
      studentId: studentId ? +studentId : undefined,
      groupId: groupId ? +groupId : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Payment by id' })
  @ApiResponse({ type: PaymentResponseDto })
  async getOne(@Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.findOne(id);
  }

  @Put('mark-as-paid/:id')
  @ApiOperation({ summary: 'Mark as paid' })
  async markAsPaid(@Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.markAsPaid(id);
  }

  @Put('pay-partial/:id')
  @ApiOperation({ summary: 'Pay partial' })
  async payPartial(
    @Param('id', ParseIntPipe) id: number,
    @Query('amount') amount: number,
  ) {
    return this.paymentsService.payPartial(id, amount);
  }
}
