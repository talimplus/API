import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';
import { StatisticsService } from '@/modules/statistics/statistics.service';
import { DashboardResponseDto } from '@/modules/statistics/dto/dashboard-response.dto';
import { DashboardQueryDto } from '@/modules/statistics/dto/dashboard-query.dto';

@ApiTags('Statistics')
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Dashboard statistics',
    description:
      'Aggregated org/center statistics for a month range: income/payments, expenses, payroll, students.',
  })
  @ApiResponse({ type: DashboardResponseDto })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiQuery({ name: 'fromMonth', required: false, example: '2026-01' })
  @ApiQuery({ name: 'toMonth', required: false, example: '2026-03' })
  async dashboard(@Req() req: any, @Query() query: DashboardQueryDto) {
    return this.statisticsService.getDashboard(
      req.user.organizationId,
      req.user.centerId,
      query,
    );
  }
}

