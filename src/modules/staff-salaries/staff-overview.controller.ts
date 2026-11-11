import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { StaffOverviewService } from '@/modules/staff-salaries/staff-overview.service';
import {
  OutstandingKind,
  StaffDeductionsService,
} from '@/modules/staff-salaries/staff-deductions.service';
import { StaffBonusesService } from '@/modules/staff-salaries/staff-bonuses.service';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';
import {
  CreateStaffAdvanceDto,
  CreateStaffBonusDto,
} from '@/modules/staff-salaries/dto/create-staff-adjustment.dto';
import { CreateStaffDeductionDto } from '@/modules/staff-salaries/dto/create-staff-deduction.dto';
import { StaffOverviewResponseDto } from '@/modules/staff-salaries/dto/staff-overview-response.dto';

@ApiTags('Staff')
@ApiBearerAuth('access-token')
@Controller('staff')
export class StaffOverviewController {
  constructor(
    private readonly overviewService: StaffOverviewService,
    private readonly deductionsService: StaffDeductionsService,
    private readonly bonusesService: StaffBonusesService,
  ) {}

  @Get('me/overview')
  @RequirePermissions('staffAttendance.viewOwn')
  @ApiOperation({
    summary:
      'Xodimning O‘Z sahifasi: davomat, kechikishlar, jarimalar, oylik holati',
  })
  @ApiQuery({ name: 'forMonth', required: false, example: '2026-09' })
  @ApiResponse({ type: StaffOverviewResponseDto })
  myOverview(@Req() req: any, @Query('forMonth') forMonth?: string) {
    return this.overviewService.getOverview(req.user, null, forMonth);
  }

  @Get(':userId/overview')
  @RequirePermissions('staffPerformance.view', 'staffAttendance.viewOwn')
  @ApiOperation({
    summary:
      'Xodim sahifasi: davomat (oyma-oy), kechikishlar, topshirilmagan pullar, jarimalar',
    description:
      'Boshqa xodimning sahifasi uchun `staffPerformance.view` kerak; ' +
      'o‘z sahifasini har kim ko‘ra oladi.',
  })
  @ApiQuery({ name: 'forMonth', required: false, example: '2026-09' })
  @ApiResponse({ type: StaffOverviewResponseDto })
  overview(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: any,
    @Query('forMonth') forMonth?: string,
  ) {
    return this.overviewService.getOverview(req.user, userId, forMonth);
  }

  @Get(':userId/deductions')
  @RequirePermissions('staffPerformance.view')
  @ApiOperation({ summary: 'Xodimning barcha jarimalari' })
  deductions(@Param('userId', ParseIntPipe) userId: number, @Req() req: any) {
    return this.deductionsService.listForUser(userId, req.user);
  }

  @Post('deductions')
  @RequirePermissions('payroll.deduct')
  @ApiOperation({
    summary: 'Jarima yozish (oylikdan ushlab qolish)',
    description:
      'Summa oylikdan katta bo‘lishi mumkin — o‘sha oyda sig‘gani ushlanadi, ' +
      'qolgani keyingi oyliklardan avtomatik ushlanadi.',
  })
  createDeduction(@Body() dto: CreateStaffDeductionDto, @Req() req: any) {
    // Avans — alohida endpoint va ruxsat (`POST /staff/advances`, `payroll.pay`).
    if (dto.type === StaffDeductionType.ADVANCE) {
      throw new BadRequestException('Avans uchun POST /staff/advances');
    }
    return this.deductionsService.create(dto, req.user);
  }

  @Delete('deductions/:id')
  @RequirePermissions('payroll.deduct')
  @ApiOperation({
    summary: 'Jarimani bekor qilish',
    description:
      'Allaqachon to‘langan oylikda hisobga olingan jarimani o‘chirib bo‘lmaydi.',
  })
  removeDeduction(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.deductionsService.remove(id, req.user, OutstandingKind.FINE);
  }

  @Post('advances')
  @RequirePermissions('payroll.pay')
  @ApiOperation({
    summary: 'Avans berish (keyingi oylikdan ushlanadi)',
    description:
      'Pul hozir beriladi va `forMonth` (default — joriy oy, keyingi oy ham mumkin) ' +
      "oyligidan ushlanadi; oylikka sig'masa qolgani keyingi oyliklardan. " +
      "Jarima emas: oylik qatorida `advanceAmount`, hisobotda berilgan pulga qo'shiladi. " +
      'Javob — `staff_deductions` yozuvi (`type: "advance"`).',
  })
  createAdvance(@Body() dto: CreateStaffAdvanceDto, @Req() req: any) {
    return this.deductionsService.createAdvance(dto, req.user);
  }

  @Delete('advances/:id')
  @RequirePermissions('payroll.pay')
  @ApiOperation({ summary: 'Avansni bekor qilish (xato kiritilgan bo‘lsa)' })
  removeAdvance(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.deductionsService.remove(id, req.user, OutstandingKind.ADVANCE);
  }

  @Get(':userId/bonuses')
  @RequirePermissions('staffPerformance.view')
  @ApiOperation({ summary: 'Xodimning barcha mukofotlari' })
  bonuses(@Param('userId', ParseIntPipe) userId: number, @Req() req: any) {
    return this.bonusesService.listForUser(userId, req.user);
  }

  @Post('bonuses')
  @RequirePermissions('payroll.pay')
  @ApiOperation({
    summary: "Mukofot (oylikka qo'shiladi)",
    description:
      "`forMonth` (default — joriy oy, kelajak emas) oyligiga qo'shiladi va oylik bilan " +
      'birga beriladi. To‘langan oylikka qo‘shilsa oylik yana "qisman" bo‘ladi.',
  })
  createBonus(@Body() dto: CreateStaffBonusDto, @Req() req: any) {
    return this.bonusesService.create(dto, req.user);
  }

  @Delete('bonuses/:id')
  @RequirePermissions('payroll.pay')
  @ApiOperation({
    summary: 'Mukofotni bekor qilish',
    description: 'Oylik bilan berib bo‘lingan mukofot — 400.',
  })
  removeBonus(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.bonusesService.remove(id, req.user);
  }
}
