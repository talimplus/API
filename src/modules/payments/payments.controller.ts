import { PaginatedPaymentResponseDto } from '@/modules/payments/dto/paginated-payment-response.dto';
import { PaymentResponseDto } from '@/modules/payments/dto/payment-reponse.dto';
import { PaymentStatus } from '@/modules/payments/entities/payment.entity';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { UserRole } from '@/common/enums/user-role.enums';
import { Roles } from '@/decorators/roles.decorator';
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
  @ApiQuery({ name: 'centerId', required: false, type: Number })
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
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      'Search by student firstName/lastName/phone or group name (case-insensitive, partial match).',
    example: 'ali',
  })
  async findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
    @Query('status') status?: PaymentStatus,
    @Query('forMonth') forMonth?: string, // YYYY-MM
    @Query('overdueOnly') overdueOnly?: string, // 'true' | 'false'
    @Query('studentId') studentId?: number,
    @Query('groupId') groupId?: number,
    @Query('search') search?: string,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    return this.paymentsService.findAll(
      req.user.organizationId,
      {
        centerId: effectiveCenterId,
        page: page ? +page : 1,
        perPage: perPage ? +perPage : 10,
        status,
        forMonth,
        overdueOnly: overdueOnly === 'true',
        studentId: studentId ? +studentId : undefined,
        groupId: groupId ? +groupId : undefined,
        search,
      },
      req.user,
    );
  }

  @Put('mark-as-paid/:id')
  @ApiOperation({ summary: 'Mark as paid' })
  @Roles(
    UserRole.RECEPTION,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  )
  async markAsPaid(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    // Reception -> pending receipt; Admin/SuperAdmin -> auto-confirmed receipt + payment updated
    return this.paymentsService.submitFullReceipt(id, req.user);
  }

  @Put('pay-partial/:id')
  @ApiOperation({ summary: 'Pay partial' })
  @Roles(
    UserRole.RECEPTION,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  )
  async payPartial(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('amount') amount: number,
  ) {
    return this.paymentsService.submitReceipt(id, Number(amount), req.user);
  }

  @Put('confirm-receipt/:id')
  @ApiOperation({ summary: 'Confirm a payment receipt (admin approval)' })
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async confirmReceipt(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.confirmReceipt(id, req.user);
  }

  @Get('pending-receipts')
  @ApiOperation({ summary: 'List pending payment receipts' })
  @ApiQuery({ name: 'centerId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async pendingReceipts(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN;
    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    return this.paymentsService.listPendingReceipts(req.user.organizationId, {
      centerId: effectiveCenterId,
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Payment by id' })
  @ApiResponse({ type: PaymentResponseDto })
  async getOne(@Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.findOne(id);
  }
}
