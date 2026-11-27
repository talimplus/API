import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { UserRole } from '@/common/enums/user-role.enums';
import { StaffSalariesService } from '@/modules/staff-salaries/staff-salaries.service';
import { StaffSalaryResponseDto } from '@/modules/staff-salaries/dto/staff-salary-response.dto';
import { PayStaffSalaryDto } from '@/modules/staff-salaries/dto/pay-staff-salary.dto';
import { StaffSalaryDetailsService } from '@/modules/staff-salaries/staff-salary-details.service';

@ApiTags('Staff Salaries')
@ApiBearerAuth('access-token')
@Controller('staff-salaries')
export class StaffSalariesController {
  constructor(
    private readonly staffSalariesService: StaffSalariesService,
    private readonly detailsService: StaffSalaryDetailsService,
  ) {}

  @Get('details')
  @RequirePermissions('payroll.view')
  @ApiOperation({
    summary: 'Xodimning shu oy oyligi batafsil hisobi (userId + forMonth)',
    description:
      "Front sahifasi `/payroll/:userId/:month` uchun. Oylik qatori yo'q bo'lsa — 404.",
  })
  @ApiQuery({ name: 'userId', required: true, example: 358 })
  @ApiQuery({ name: 'forMonth', required: true, example: '2026-10' })
  @ApiResponse({ status: 200, description: 'Batafsil hisob' })
  async detailsByMonth(
    @Req() req: any,
    @Query('userId', ParseIntPipe) userId: number,
    @Query('forMonth') forMonth: string,
  ) {
    return this.detailsService.detailsByMonth(
      req.user.organizationId,
      userId,
      forMonth,
    );
  }

  @Get(':id/details')
  @RequirePermissions('payroll.view')
  @ApiOperation({
    summary: "Bitta oylikning batafsil hisobi (chek ko'rinishi)",
    description:
      "Ustama guruhlar bo'yicha, oylar orasidagi o'tkazmalar (o'quvchi, guruh, to'lov sanasi bilan), " +
      'mukofot/jarimalar, avanslar (qaysi oydan qancha ushlangani), berilgan pullar va yakuniy hisob. ' +
      'Hech narsa yozmaydi.',
  })
  @ApiResponse({ status: 200, description: 'Batafsil hisob' })
  async details(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.detailsService.details(req.user.organizationId, id);
  }

  @Get()
  @RequirePermissions('payroll.view')
  @ApiOperation({
    summary: 'List staff salaries for a month',
    description:
      'Ensures salary rows exist for the requested month (so the table is never empty). Future months are not allowed.',
  })
  @ApiQuery({
    name: 'forMonth',
    required: false,
    example: '2026-01',
    description: 'Month in YYYY-MM. Defaults to current month.',
  })
  @ApiQuery({
    name: 'centerId',
    required: false,
    description:
      'Center filter. Admin/SuperAdmin: optional (if omitted, returns all centers).',
  })
  @ApiResponse({ type: StaffSalaryResponseDto, isArray: true })
  async findAll(
    @Req() req: any,
    @Query('forMonth') forMonth?: string,
    @Query('centerId') centerId?: number,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    return this.staffSalariesService.findAll(
      req.user.organizationId,
      forMonth,
      effectiveCenterId,
    );
  }

  @Put('pay/:id')
  @RequirePermissions('payroll.pay')
  @ApiOperation({
    summary: 'Pay staff salary (partial or full)',
    description:
      'Adds to paidAmount, updates status (paid/partial/unpaid), sets paidAt when fully paid.',
  })
  @ApiBody({ type: PayStaffSalaryDto })
  @ApiResponse({ type: StaffSalaryResponseDto })
  async pay(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayStaffSalaryDto,
    @Req() req: any,
  ) {
    return this.staffSalariesService.pay(id, dto, req.user);
  }
}
