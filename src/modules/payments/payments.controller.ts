import { PaginatedPaymentResponseDto } from '@/modules/payments/dto/paginated-payment-response.dto';
import { PaymentResponseDto } from '@/modules/payments/dto/payment-reponse.dto';
import { PaymentStatus } from '@/modules/payments/entities/payment.entity';
import { PaymentMethod } from '@/modules/payments/entities/payment-receipt.entity';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { UserRole } from '@/common/enums/user-role.enums';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
  Res,
  Body,
} from '@nestjs/common';
import type { Response } from 'express';
import { UpdatePaymentDto } from '@/modules/payments/dto/update-payment.dto';
import { CalculatePaymentDto } from '@/modules/payments/dto/calculate-payment.dto';
import { PayStudentDebtDto } from '@/modules/payments/dto/pay-student-debt.dto';
import {
  ApplyExclusionDto,
  PreviewExclusionDto,
} from '@/modules/payments/dto/payment-exclusion.dto';
import { ConfirmReceiptsDto } from '@/modules/payments/dto/confirm-receipts.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}
  @Get()
  @RequirePermissions('payments.view')
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
    name: 'teacherId',
    required: false,
    type: Number,
    description: "Filter by the teacher of the payment's group.",
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description:
      "Oraliq boshi (YYYY-MM-DD yoki YYYY-MM). To'lov OYI (forMonth) bo'yicha " +
      "filterlanadi; sana oy o'rtasi bo'lsa ham o'sha oy to'liq kiradi. " +
      "dateTo'siz ham berilishi mumkin.",
    example: '2026-01-01',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description:
      "Oraliq oxiri (YYYY-MM-DD yoki YYYY-MM). dateFrom'siz ham berilishi mumkin.",
    example: '2026-03-31',
  })
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
    @Query('teacherId') teacherId?: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;

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
        teacherId: teacherId ? +teacherId : undefined,
        dateFrom,
        dateTo,
        search,
      },
      req.user,
    );
  }

  @Get('export')
  @ApiOperation({
    summary: "Export payments to Excel (filterlangan ko'rinishda)",
    description:
      'GET /payments bilan AYNAN bir xil filterlarni qabul qiladi va natijani ' +
      '.xlsx fayl sifatida qaytaradi (paginatsiyasiz — filterga mos barcha ' +
      "yozuvlar). Masalan o'qituvchi yoki guruh bo'yicha filter qilingan bo'lsa, " +
      "faqat shu o'qituvchi/guruhning to'lovlari yuklanadi. dateFrom/dateTo " +
      'bilan oraliq ham berilishi mumkin (ikkalasi ham ixtiyoriy, faqat biri ' +
      "berilsa bir tomonlama filter bo'ladi).",
  })
  @ApiQuery({ name: 'centerId', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: PaymentStatus })
  @ApiQuery({
    name: 'forMonth',
    required: false,
    description: 'Filter by month (YYYY-MM)',
    example: '2026-01',
  })
  @ApiQuery({ name: 'overdueOnly', required: false, example: 'true' })
  @ApiQuery({ name: 'studentId', required: false, type: Number })
  @ApiQuery({ name: 'groupId', required: false, type: Number })
  @ApiQuery({ name: 'teacherId', required: false, type: Number })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description:
      "Oraliq boshi (YYYY-MM-DD yoki YYYY-MM). To'lov OYI (forMonth) bo'yicha " +
      "filterlanadi; sana oy o'rtasi bo'lsa ham o'sha oy to'liq kiradi. " +
      "dateTo'siz ham berilishi mumkin.",
    example: '2026-01-01',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description:
      "Oraliq oxiri (YYYY-MM-DD yoki YYYY-MM). dateFrom'siz ham berilishi mumkin.",
    example: '2026-03-31',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({
    status: 200,
    description: 'Excel fayl (.xlsx)',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @RequirePermissions('payments.export')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportExcel(
    @Req() req: any,
    @Res() res: Response,
    @Query('centerId') centerId?: string,
    @Query('status') status?: PaymentStatus,
    @Query('forMonth') forMonth?: string,
    @Query('overdueOnly') overdueOnly?: string,
    @Query('studentId') studentId?: string,
    @Query('groupId') groupId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    const { buffer, fileName } = await this.paymentsService.exportToExcel(
      req.user.organizationId,
      {
        centerId: effectiveCenterId,
        status,
        forMonth,
        overdueOnly: overdueOnly === 'true',
        studentId: studentId ? +studentId : undefined,
        groupId: groupId ? +groupId : undefined,
        teacherId: teacherId ? +teacherId : undefined,
        dateFrom,
        dateTo,
        search,
      },
      req.user,
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Put('mark-as-paid/:id')
  @ApiOperation({ summary: 'Mark as paid' })
  @ApiBody({
    schema: {
      properties: {
        comment: { type: 'string', nullable: true },
        paymentMethod: {
          type: 'string',
          enum: Object.values(PaymentMethod),
          nullable: true,
        },
        paidAt: {
          type: 'string',
          format: 'date',
          nullable: true,
          description:
            "To'lov amalga oshirilgan sana (asosan KARTA uchun). YYYY-MM-DD.",
        },
      },
    },
    required: false,
  })
  @RequirePermissions('payments.create')
  async markAsPaid(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body('comment') comment?: string,
    @Body('paymentMethod') paymentMethod?: PaymentMethod,
    @Body('paidAt') paidAt?: string,
  ) {
    return this.paymentsService.submitFullReceipt(
      id,
      req.user,
      comment,
      paymentMethod,
      paidAt,
    );
  }

  @Put('pay-partial/:id')
  @ApiOperation({ summary: 'Pay partial' })
  @ApiBody({
    schema: {
      required: ['amount'],
      properties: {
        amount: { type: 'number' },
        comment: { type: 'string', nullable: true },
        paymentMethod: {
          type: 'string',
          enum: Object.values(PaymentMethod),
          nullable: true,
        },
        paidAt: {
          type: 'string',
          format: 'date',
          nullable: true,
          description:
            "To'lov amalga oshirilgan sana (asosan KARTA uchun). YYYY-MM-DD.",
        },
      },
    },
  })
  @RequirePermissions('payments.create')
  async payPartial(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body('amount') amount: number,
    @Body('comment') comment?: string,
    @Body('paymentMethod') paymentMethod?: PaymentMethod,
    @Body('paidAt') paidAt?: string,
  ) {
    return this.paymentsService.submitReceipt(
      id,
      Number(amount),
      req.user,
      comment,
      paymentMethod,
      paidAt,
    );
  }

  @Put('confirm-receipt/:id')
  @ApiOperation({ summary: 'Confirm a payment receipt (admin approval)' })
  @RequirePermissions('receipts.confirm')
  async confirmReceipt(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.confirmReceipt(id, req.user);
  }

  @Put('reject-receipt/:id')
  @ApiOperation({ summary: 'Reject a payment receipt (admin rejection)' })
  @RequirePermissions('receipts.reject')
  async rejectReceipt(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    return this.paymentsService.rejectReceipt(id, req.user, reason);
  }

  @Get('pending-receipts')
  @ApiOperation({
    summary: 'List pending payment receipts',
    description:
      "Tasdiq kutayotgan to'lovlar. dateFrom/dateTo — pul QABUL QILINGAN sana " +
      "(receivedAt, bo'sh bo'lsa createdAt) bo'yicha, ikkalasi ham ixtiyoriy. " +
      'meta.totalAmount — filterga mos BARCHA pending receiptlar summasi ' +
      '(joriy sahifa emas), "Barchasini oldim" tugmasida ko\'rsatish uchun.',
  })
  @ApiQuery({ name: 'centerId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: "Qabul qilingan sana oralig'i boshi (YYYY-MM-DD).",
    example: '2026-09-01',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description:
      "Qabul qilingan sana oralig'i oxiri (YYYY-MM-DD). Shu kun ham kiradi.",
    example: '2026-09-20',
  })
  @RequirePermissions('receipts.view')
  async pendingReceipts(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;
    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    return this.paymentsService.listPendingReceipts(req.user.organizationId, {
      centerId: effectiveCenterId,
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 20,
      dateFrom,
      dateTo,
    });
  }

  @Get('receipts-stats')
  @ApiOperation({
    summary: "To'lov cheklari statistikasi — sahifa tepasidagi bloklar uchun",
    description:
      "Bitta so'rovda uchala holat: tasdiqlangan / tasdiq kutilmoqda / rad etilgan " +
      '(har biriga soni va summasi). Filterlar GET /payments/pending-receipts ' +
      "bilan aynan bir xil, sana ham bir xil maydon bo'yicha — pul QABUL QILINGAN " +
      "sana (receivedAt, bo'sh bo'lsa createdAt). `total` = tasdiqlangan + " +
      "kutilayotgan (rad etilgan pul kassaga kirmagani uchun qo'shilmaydi).",
  })
  @ApiQuery({ name: 'centerId', required: false, type: Number })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: "Qabul qilingan sana oralig'i boshi (YYYY-MM-DD).",
    example: '2026-09-01',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description:
      "Qabul qilingan sana oralig'i oxiri (YYYY-MM-DD). Shu kun ham kiradi.",
    example: '2026-09-20',
  })
  @ApiResponse({
    schema: {
      example: {
        confirmed: { count: 42, amount: 18400000 },
        pending: { count: 7, amount: 2350000 },
        rejected: { count: 2, amount: 400000 },
        total: { count: 49, amount: 20750000 },
      },
    },
  })
  @RequirePermissions('receipts.view')
  async receiptsStats(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;
    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    return this.paymentsService.getReceiptsStats(req.user.organizationId, {
      centerId: effectiveCenterId,
      dateFrom,
      dateTo,
    });
  }

  @Put('confirm-receipts')
  @ApiOperation({
    summary:
      'Bir nechta (yoki barcha) receiptni tasdiqlash — "oldim" qilib belgilash',
    description:
      'Ikki rejimda ishlaydi:\n' +
      '1) `receiptIds: [12, 13]` — frontendda checkbox bilan belgilanganlar.\n' +
      '2) `all: true` — filterga (centerId/dateFrom/dateTo) mos BARCHA pending ' +
      'receiptlar ("Barchasini oldim" tugmasi). Filter berilmasa — hammasi.\n\n' +
      'Har biri yakka tasdiqlash (PUT /payments/confirm-receipt/:id) bilan bir xil ' +
      "o'tadi: pul payment'ga qo'shiladi, komissiya snapshot'i olinadi, chek " +
      "yasaladi. Bittasi xato bersa qolganlari to'xtamaydi — javobda nima " +
      "tasdiqlangani, nima o'tkazib yuborilgani va nima xato berganigacha ko'rinadi. " +
      'Boshqa tashkilot yoki markazning receipti hech qachon tasdiqlanmaydi.',
  })
  @ApiBody({ type: ConfirmReceiptsDto })
  @ApiResponse({
    schema: {
      example: {
        requested: 3,
        confirmedCount: 2,
        confirmedAmount: 550000,
        skippedCount: 1,
        failedCount: 0,
        confirmed: [
          { receiptId: 12, amount: 350000, checkNo: '1-A' },
          { receiptId: 13, amount: 200000, checkNo: '2' },
        ],
        skipped: [14],
        failed: [],
      },
    },
  })
  @RequirePermissions('receipts.confirm')
  async confirmReceipts(@Req() req: any, @Body() dto: ConfirmReceiptsDto) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;
    const effectiveCenterId = isAdmin ? dto.centerId : req.user.centerId;

    return this.paymentsService.confirmReceiptsBulk(
      req.user.organizationId,
      req.user,
      {
        receiptIds: dto.receiptIds,
        all: dto.all,
        centerId: effectiveCenterId,
        dateFrom: dto.dateFrom,
        dateTo: dto.dateTo,
      },
    );
  }

  @Put('calculate/:id')
  @RequirePermissions('payments.recalculate')
  @ApiOperation({
    summary: 'Calculate payment amount for partial month study (preview only)',
    description:
      'Calculate how much student should pay if they study until a specific date. Does NOT update the payment, only returns calculation result. Useful for reception to show student before actual payment.',
  })
  @ApiBody({ type: CalculatePaymentDto })
  @ApiResponse({
    schema: {
      example: {
        paymentId: 123,
        studentId: 45,
        studentName: 'Ali Valiyev',
        forMonth: '2026-01-01',
        plannedStudyUntilDate: '2026-01-20',
        lessonsPlanned: 12,
        lessonsBillable: 8,
        discountPercent: 10,
        amountDue: 150000,
        currentAmountDue: 200000,
        difference: -50000,
      },
    },
  })
  async calculatePayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CalculatePaymentDto,
  ) {
    return this.paymentsService.calculatePayment(id, dto);
  }

  @Get('student/:studentId/summary')
  @ApiOperation({
    summary: 'Get student payment summary (view page)',
    description:
      "O'quvchi haqida qisqa ma'lumot + har oy bo'yicha to'lovlar (amountDue, " +
      'amountPaid, pendingAmount, receivedAmount, remaining, payableNow, status) + ' +
      'jami xulosa (totalDue, totalPaid, totalDebt, totalPending, totalReceived, ' +
      'payableNow). Oylar eng yangisidan eskisiga tartiblangan.\n\n' +
      'MUHIM — uchta summa farqi:\n' +
      '- amountPaid/totalPaid: admin TASDIQLAGAN, kassaga tushgan pul.\n' +
      '- pendingAmount/totalPending: reception olgan, tasdiq kutayotgan pul ' +
      "(pul o'sha xodim zimmasida).\n" +
      "- receivedAmount/totalReceived = amountPaid + pendingAmount: o'quvchi " +
      "haqiqatda topshirgan pul. O'quvchidan yana qancha olish kerakligi " +
      '(payableNow) ayni shundan hisoblanadi, remaining esa kassa qarzi.',
  })
  @ApiResponse({
    schema: {
      example: {
        student: {
          id: 45,
          firstName: 'Ali',
          lastName: 'Valiyev',
          phone: '+998901234567',
          status: 'active',
          monthlyFee: 400000,
        },
        totals: {
          totalDue: 800000,
          totalPaid: 0,
          totalDebt: 800000,
          totalPending: 200000,
          totalReceived: 200000,
          payableNow: 600000,
        },
        months: [
          {
            paymentId: 650,
            forMonth: '2026-09',
            groupId: 12,
            groupName: 'Ingliz tili A1',
            amountDue: 280000,
            amountPaid: 0,
            pendingAmount: 200000,
            receivedAmount: 200000,
            remaining: 280000,
            payableNow: 80000,
            status: 'unpaid',
            lessonsPlanned: 10,
            lessonsBillable: 8,
            lessonsExcused: 0,
            effectiveBillable: 8,
            fullAmount: 350000,
            isProrated: true,
          },
        ],
      },
    },
  })
  @RequirePermissions('payments.view')
  async studentSummary(
    @Req() req: any,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.paymentsService.getStudentPaymentSummary(studentId, req.user);
  }

  @Put('pay-debt/student/:studentId')
  @ApiOperation({
    summary: "Pay student total debt (jami qarzni to'lash)",
    description:
      "Bitta summani o'quvchining ochiq (unpaid/partial) oylariga eng eskisidan " +
      "boshlab taqsimlaydi. `amount` berilmasa — jami qarz to'liq to'lanadi. " +
      "Misol: 400000/oy dan 2 oy (800000) qarzi bo'lgan o'quvchi 600000 to'lasa, " +
      "1-oy to'liq yopiladi va 2-oyga 200000 tushib, 200000 qarz qoladi. " +
      'Admin/super_admin uchun avtomatik tasdiqlanadi; reception/manager uchun ' +
      'PENDING receipt yaratiladi (admin keyin tasdiqlaydi).',
  })
  @ApiBody({ type: PayStudentDebtDto })
  @ApiResponse({
    schema: {
      example: {
        studentId: 45,
        requestedAmount: 600000,
        distributedAmount: 600000,
        unallocated: 0,
        allocations: [
          {
            paymentId: 649,
            forMonth: '2026-08',
            groupId: 12,
            allocated: 400000,
            pending: false,
            checkNo: '5',
            transactionNo: 'TRX-20260906-000123',
          },
          {
            paymentId: 650,
            forMonth: '2026-09',
            groupId: 12,
            allocated: 200000,
            pending: false,
            checkNo: '6-A',
            transactionNo: 'TRX-20260906-000124',
          },
        ],
        summary: { student: {}, totals: {}, months: [] },
      },
    },
  })
  @RequirePermissions('payments.create')
  async payStudentDebt(
    @Req() req: any,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: PayStudentDebtDto,
  ) {
    return this.paymentsService.payStudentDebt(
      studentId,
      dto.amount,
      req.user,
      dto.comment,
      dto.paymentMethod,
      dto.paidAt,
    );
  }

  @Get('receipt/:receiptId/check')
  @ApiOperation({
    summary: 'Get printable payment check/receipt (chek chiqarish)',
    description:
      "Bitta receipt (to'lov) uchun chek ma'lumotlari: chek raqami (1, 1-A, " +
      "1-A-B...), o'quvchi ism-familiyasi, telefon, guruh, o'qituvchi, to'lovdan " +
      "oldingi/keyingi qoldiq, to'lov usuli, summa va sana-vaqt. Frontendda " +
      'chekni chop etish uchun ishlatiladi.',
  })
  @ApiResponse({
    schema: {
      example: {
        receiptId: 12,
        checkNo: '1-A',
        transactionNo: 'TRX-20260906-000123',
        invoiceNo: 1,
        installmentIndex: 1,
        status: 'confirmed',
        student: {
          id: 45,
          firstName: 'Ali',
          lastName: 'Valiyev',
          fullName: 'Ali Valiyev',
          phone: '+998901234567',
        },
        group: { id: 12, name: 'Ingliz tili A1' },
        teacher: { id: 7, fullName: 'Dilnoza Karimova' },
        forMonth: '2026-09',
        amount: 200000,
        balanceBefore: 400000,
        balanceAfter: 200000,
        paymentMethod: 'card',
        paidAt: '2026-09-06',
        receivedAt: '2026-09-06T10:15:00.000Z',
        createdAt: '2026-09-06T10:15:00.000Z',
        receivedBy: { id: 3, fullName: 'Reception Xodim' },
        comment: null,
      },
    },
  })
  @RequirePermissions('payments.view')
  async getReceiptCheck(@Param('receiptId', ParseIntPipe) receiptId: number) {
    return this.paymentsService.buildCheckFromReceipt(receiptId);
  }

  @Get(':paymentId/receipts')
  @ApiOperation({
    summary: "Payment uchun to'lovlar tarixi (cheklar ro'yxati)",
    description:
      "Bitta payment (o'quvchining bitta oyi) uchun qilingan BARCHA to'lovlarni " +
      "(receipt'larni) chek ko'rinishida qaytaradi. Har bir element — " +
      'GET /payments/receipt/:receiptId/check qaytaradigan chek obyektining ' +
      "aynan o'zi (receiptId bilan). Frontend shu bitta so'rov bilan ham tarix " +
      "jadvalini chizadi, ham chekni chop etadi (qo'shimcha so'rovsiz). Tartib: " +
      "receivedAt bo'yicha ASC. Rad etilgan (rejected) receipt'lar ham status'i " +
      'bilan qaytadi.',
  })
  @ApiResponse({
    schema: {
      example: {
        data: [
          {
            receiptId: 12,
            checkNo: '1-A',
            transactionNo: 'TRX-20260906-000123',
            invoiceNo: 1,
            installmentIndex: 1,
            status: 'confirmed',
            student: {
              id: 45,
              firstName: 'Ali',
              lastName: 'Valiyev',
              fullName: 'Ali Valiyev',
              phone: '+998901234567',
            },
            group: { id: 12, name: 'Ingliz tili A1' },
            teacher: { id: 7, fullName: 'Dilnoza Karimova' },
            forMonth: '2026-09',
            amount: 200000,
            balanceBefore: 400000,
            balanceAfter: 200000,
            paymentMethod: 'card',
            paidAt: '2026-09-06',
            receivedAt: '2026-09-06T10:15:00.000Z',
            createdAt: '2026-09-06T10:15:00.000Z',
            receivedBy: { id: 3, fullName: 'Reception Xodim' },
            comment: null,
          },
        ],
      },
    },
  })
  @RequirePermissions('payments.view')
  async getPaymentReceipts(
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ) {
    return this.paymentsService.getReceiptsForPayment(paymentId);
  }

  @Put('preview-exclusion/:id')
  @ApiOperation({
    summary:
      'Preview payment exclusion (chiqarib tashlashni oldindan hisoblash)',
    description:
      'Bir oy (payment) uchun excludeLessons (kun) yoki excludeAmount (summa) ' +
      "yuborilganda to'lanadigan yangi summani hisoblab beradi. SAQLAMAYDI — " +
      "faqat frontendda jonli ko'rsatish uchun. Kun yuborilsa perLessonAmount " +
      'orqali summaga aylantiriladi.',
  })
  @ApiBody({ type: PreviewExclusionDto })
  @ApiResponse({
    schema: {
      example: {
        paymentId: 649,
        forMonth: '2026-08',
        lessonsPlanned: 10,
        lessonsBillable: 10,
        perLessonAmount: 35000,
        baseAmountDue: 350000,
        currentAmountDue: 350000,
        amountPaid: 0,
        excludeLessons: 2,
        excludedAmount: 70000,
        newAmountDue: 280000,
        newRemaining: 280000,
      },
    },
  })
  @RequirePermissions('payments.exclusion')
  async previewExclusion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PreviewExclusionDto,
  ) {
    return this.paymentsService.previewExclusion(id, {
      excludeLessons: dto.excludeLessons,
      excludeAmount: dto.excludeAmount,
    });
  }

  @Put('apply-exclusion/:id')
  @ApiOperation({
    summary: 'Apply payment exclusion (chiqarib tashlashni saqlash)',
    description:
      'Bir oy (payment) uchun chiqarib tashlashni SAQLAYDI: amountDue kamayadi ' +
      'va sabab (comment) yoziladi. excludeLessons yoki excludeAmount bilan birga ' +
      'comment MAJBURIY. Recalc paytida ham saqlanadi. Saqlangandan keyin frontend ' +
      'pay-partial/pay-debt orqali kamaygan summani qabul qiladi.',
  })
  @ApiBody({ type: ApplyExclusionDto })
  @RequirePermissions('payments.exclusion')
  async applyExclusion(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyExclusionDto,
  ) {
    return this.paymentsService.applyExclusion(
      id,
      {
        excludeLessons: dto.excludeLessons,
        excludeAmount: dto.excludeAmount,
        comment: dto.comment,
      },
      req.user,
    );
  }

  @Get(':id')
  @RequirePermissions('payments.view')
  @ApiOperation({ summary: 'Get Payment by id' })
  @ApiResponse({ type: PaymentResponseDto })
  async getOne(@Param('id', ParseIntPipe) id: number) {
    return this.paymentsService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('payments.update')
  @ApiOperation({
    summary: 'Update payment (e.g., set planned study end date)',
    description:
      'Update payment details like plannedStudyUntilDate. Recalculates amountDue based on prorated lessons.',
  })
  @ApiBody({ type: UpdatePaymentDto })
  @ApiResponse({ type: PaymentResponseDto })
  async updatePayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.paymentsService.updatePayment(id, dto);
  }
}
