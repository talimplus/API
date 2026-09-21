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
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { StaffAttendanceService } from './staff-attendance.service';
import { CheckInDto } from './dto/check-in.dto';
import { ManualCheckInDto } from './dto/manual-check-in.dto';
import { QueryStaffAttendanceDto } from './dto/query-staff-attendance.dto';
import {
  PaginatedStaffAttendanceResponseDto,
  StaffAttendanceReportDto,
  StaffAttendanceResponseDto,
  StaffAttendanceTodayDto,
} from './dto/staff-attendance-response.dto';

@ApiTags('Staff Attendance')
@Controller('staff-attendance')
export class StaffAttendanceController {
  constructor(private readonly service: StaffAttendanceService) {}

  // ── Xodimning o'zi ──────────────────────────────────────────

  @Post('check-in')
  @RequirePermissions('staffAttendance.checkIn')
  @ApiOperation({
    summary: '“Keldim” — xodim ishga kelganini belgilaydi',
    description:
      'Joylashuv va qurilma ma’lumotlari ixtiyoriy: berilmasa ham yozuv yaratiladi, ' +
      'faqat ishonch darajasi (confidence) pasayadi. Kuniga bitta yozuv — ' +
      'takroriy bosilsa mavjud yozuv qaytariladi (alreadyCheckedIn: true).',
  })
  @ApiResponse({ type: StaffAttendanceResponseDto })
  checkIn(@Body() dto: CheckInDto, @Req() req: any) {
    return this.service.checkIn(req.user, dto, req);
  }

  @Get('me/today')
  @RequirePermissions('staffAttendance.viewOwn')
  @ApiOperation({
    summary:
      'Xodimning bugungi holati: belgilanganmi, birinchi dars vaqti, kechikish',
  })
  @ApiResponse({ type: StaffAttendanceTodayDto })
  myToday(@Req() req: any) {
    return this.service.getMyToday(req.user);
  }

  @Get('me')
  @RequirePermissions('staffAttendance.viewOwn')
  @ApiOperation({ summary: 'Xodimning o‘z davomat tarixi' })
  @ApiResponse({ type: PaginatedStaffAttendanceResponseDto })
  myHistory(@Req() req: any, @Query() query: QueryStaffAttendanceDto) {
    return this.service.getMyHistory(req.user, query);
  }

  // ── Admin / qabulxona ───────────────────────────────────────

  @Get()
  @RequirePermissions('staffAttendance.view')
  @ApiOperation({ summary: 'Barcha xodimlar davomati (filtr bilan)' })
  @ApiResponse({ type: PaginatedStaffAttendanceResponseDto })
  findAll(@Req() req: any, @Query() query: QueryStaffAttendanceDto) {
    return this.service.findAll(req.user, query);
  }

  @Get('report')
  @RequirePermissions('staffAttendance.view')
  @ApiOperation({
    summary:
      'Davr bo‘yicha hisobot: kelgan kunlar, kechikish daqiqalari, kelmagan kunlar, shubhali yozuvlar',
  })
  @ApiQuery({ name: 'from', required: true, example: '2026-09-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-09-30' })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiResponse({ type: StaffAttendanceReportDto })
  report(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('centerId') centerId?: number,
  ) {
    return this.service.report(
      req.user,
      from,
      to,
      centerId ? +centerId : undefined,
    );
  }

  @Post('manual')
  @RequirePermissions('staffAttendance.manage')
  @ApiOperation({
    summary:
      'Xodim o‘rniga qo‘lda belgilash (telefoni o‘chgan, internet yo‘q va h.k.)',
    description:
      'Bunday yozuv manbasi `manual` bo‘ladi va hisobotda shunday ko‘rinadi — ' +
      'tekshirib bo‘lmagani yashirilmaydi.',
  })
  @ApiResponse({ type: StaffAttendanceResponseDto })
  manual(@Body() dto: ManualCheckInDto, @Req() req: any) {
    return this.service.manualCheckIn(dto, req.user);
  }

  @Post(':id/confirm')
  @RequirePermissions('staffAttendance.manage')
  @ApiOperation({
    summary: 'Yozuvni tasdiqlash — “men bu xodimni shu yerda ko‘rdim”',
  })
  @ApiResponse({ type: StaffAttendanceResponseDto })
  confirm(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.confirm(id, req.user);
  }

  @Delete(':id')
  @RequirePermissions('staffAttendance.manage')
  @ApiOperation({ summary: 'Davomat yozuvini o‘chirish' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.remove(id, req.user);
  }
}
