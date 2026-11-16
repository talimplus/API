import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { StatisticsOverviewService } from '@/modules/statistics/statistics-overview.service';
import { StatisticsDetailsService } from '@/modules/statistics/statistics-details.service';
import {
  StatsDetailsQueryDto,
  StatsIncomeQueryDto,
  StatsRangeQueryDto,
  StatsStudentsQueryDto,
  StatsTrendQueryDto,
} from '@/modules/statistics/dto/stats-range-query.dto';
import {
  StatsOverviewResponseDto,
  StatsTrendResponseDto,
} from '@/modules/statistics/dto/stats-overview-response.dto';

const PAGED =
  'Javob: `{ fromDate, toDate, data[], meta: {total,page,perPage,totalPages}, summary: {count, amount} }`. ' +
  '`summary` qidiruvsiz holatda statistika blokidagi raqamga teng.';

@ApiTags('Statistics')
@Controller('statistics')
export class StatisticsOverviewController {
  constructor(
    private readonly overviewService: StatisticsOverviewService,
    private readonly detailsService: StatisticsDetailsService,
  ) {}

  @Get('overview')
  @RequirePermissions('statistics.view')
  @ApiOperation({
    summary: "Statistika (kun oralig'i)",
    description:
      'Kassa (kirim, qaytarilgan, xarajat, oylik/avans — pul haqiqatan qaysi kunda harakatlangan) + ' +
      "oraliq tegadigan oylar bo'yicha o'quvchi to'lovlari va qarz + o'quvchilar soni.",
  })
  @ApiResponse({ type: StatsOverviewResponseDto })
  overview(@Req() req: any, @Query() q: StatsRangeQueryDto) {
    return this.overviewService.overview(
      req.user.organizationId,
      req.user.centerId,
      q,
    );
  }

  @Get('trend')
  @RequirePermissions('statistics.view')
  @ApiOperation({
    summary: "Oxirgi N oy: tushgan pul va o'quvchilar soni (grafik uchun)",
  })
  @ApiResponse({ type: StatsTrendResponseDto })
  trend(@Req() req: any, @Query() q: StatsTrendQueryDto) {
    return this.overviewService.trend(
      req.user.organizationId,
      req.user.centerId,
      q,
    );
  }

  @Get('details/income')
  @RequirePermissions('statistics.view')
  @ApiOperation({
    summary: "Kassaga tushgan pul — cheklar ro'yxati",
    description: PAGED,
  })
  income(@Req() req: any, @Query() q: StatsIncomeQueryDto) {
    return this.detailsService.income(
      req.user.organizationId,
      req.user.centerId,
      q,
    );
  }

  @Get('details/expenses')
  @RequirePermissions('statistics.view')
  @ApiOperation({ summary: "Xarajatlar ro'yxati", description: PAGED })
  expenses(@Req() req: any, @Query() q: StatsDetailsQueryDto) {
    return this.detailsService.expenses(
      req.user.organizationId,
      req.user.centerId,
      q,
    );
  }

  @Get('details/salaries')
  @RequirePermissions('statistics.view')
  @ApiOperation({ summary: 'Berilgan oylik va avanslar', description: PAGED })
  salaries(@Req() req: any, @Query() q: StatsDetailsQueryDto) {
    return this.detailsService.salaries(
      req.user.organizationId,
      req.user.centerId,
      q,
    );
  }

  @Get('details/students')
  @RequirePermissions('statistics.view')
  @ApiOperation({ summary: "O'quvchilar (kind bo'yicha)", description: PAGED })
  students(@Req() req: any, @Query() q: StatsStudentsQueryDto) {
    return this.detailsService.students(
      req.user.organizationId,
      req.user.centerId,
      q,
    );
  }

  @Get('details/debts')
  @RequirePermissions('statistics.view')
  @ApiOperation({ summary: "Yig'ilmagan pul (qarzdorlar)", description: PAGED })
  debts(@Req() req: any, @Query() q: StatsDetailsQueryDto) {
    return this.detailsService.debts(
      req.user.organizationId,
      req.user.centerId,
      q,
    );
  }
}
