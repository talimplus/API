import {
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
import { StaffDeductionsService } from '@/modules/staff-salaries/staff-deductions.service';
import { CreateStaffDeductionDto } from '@/modules/staff-salaries/dto/create-staff-deduction.dto';
import { StaffOverviewResponseDto } from '@/modules/staff-salaries/dto/staff-overview-response.dto';

@ApiTags('Staff')
@ApiBearerAuth('access-token')
@Controller('staff')
export class StaffOverviewController {
  constructor(
    private readonly overviewService: StaffOverviewService,
    private readonly deductionsService: StaffDeductionsService,
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
    return this.deductionsService.remove(id, req.user);
  }
}
