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
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';
import { StaffSalariesService } from '@/modules/staff-salaries/staff-salaries.service';
import { StaffSalaryResponseDto } from '@/modules/staff-salaries/dto/staff-salary-response.dto';
import { PayStaffSalaryDto } from '@/modules/staff-salaries/dto/pay-staff-salary.dto';

@ApiTags('Staff Salaries')
@ApiBearerAuth('access-token')
@Controller('staff-salaries')
export class StaffSalariesController {
  constructor(private readonly staffSalariesService: StaffSalariesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
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
      req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN;

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
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
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
  ) {
    return this.staffSalariesService.pay(id, dto);
  }
}

