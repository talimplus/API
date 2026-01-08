import { Body, Controller, Get, Query, Req, Post } from '@nestjs/common';
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
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { TeacherMonthlyEarningResponseDto } from '@/modules/teacher-earnings/dto/teacher-monthly-earning-response.dto';
import { CalculateTeacherEarningDto } from '@/modules/teacher-earnings/dto/calculate-teacher-earning.dto';
import { dayjs } from '@/shared/utils/dayjs';

@ApiTags('Teacher Earnings')
@ApiBearerAuth('access-token')
@Controller('teacher-earnings')
export class TeacherEarningsController {
  constructor(private readonly teacherEarningsService: TeacherEarningsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List teacher monthly earnings (snapshots) for a month',
    description:
      'Ensures snapshots exist for teachers for the given month (no overwrite unless forced via calculate endpoint).',
  })
  @ApiQuery({
    name: 'forMonth',
    required: false,
    example: '2025-12',
    description: 'Month being earned (YYYY-MM). Defaults to current month.',
  })
  @ApiResponse({ type: TeacherMonthlyEarningResponseDto, isArray: true })
  async list(@Req() req: any, @Query('forMonth') forMonth?: string) {
    const ym = forMonth?.trim() || dayjs().format('YYYY-MM');
    return this.teacherEarningsService.listEarnings(req.user.organizationId, ym);
  }

  @Post('calculate')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Calculate teacher earning snapshot for a month',
    description:
      'Computes commission from PAID student payments for that month. Will not overwrite an existing snapshot unless force=true. If the month is already paid out, a positive diff becomes carryover for the next unpaid month.',
  })
  @ApiBody({ type: CalculateTeacherEarningDto })
  @ApiResponse({ type: TeacherMonthlyEarningResponseDto })
  async calculate(@Req() req: any, @Body() dto: CalculateTeacherEarningDto) {
    return this.teacherEarningsService.calculateTeacherEarningsForMonth(
      req.user.organizationId,
      dto.teacherId,
      dto.forMonth,
      { force: dto.force },
    );
  }
}

