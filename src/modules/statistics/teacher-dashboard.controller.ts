import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { TeacherDashboardService } from '@/modules/statistics/teacher-dashboard.service';

@ApiTags('Teacher Dashboard')
@Controller('teachers/me')
export class TeacherDashboardController {
  constructor(private readonly service: TeacherDashboardService) {}

  @Get('dashboard')
  @RequirePermissions('teacher.dashboard')
  @ApiOperation({
    summary: "O'qituvchi dashboardi: o'z guruhlari bo'yicha oy statistikasi",
    description:
      "O'quvchilar soni, tanlangan oy to'lovlari (to'liq / qisman / to'lanmagan — " +
      'soni va summasi, qarz, tasdiq kutayotgan), davomat (kelgan/kech/kelmagan/' +
      'sababli va foiz), har guruh kesimi, 6 oylik trend, qarzdorlar (tanlangan oygacha) ' +
      "va o'qituvchining shu oy daromadi. O'qituvchi doim o'zini ko'radi; boshqa rol " +
      "`teacherId` bilan istalgan o'qituvchini (aks holda 422 `teacherId`).",
  })
  @ApiQuery({ name: 'month', required: false, example: '2026-11' })
  @ApiQuery({ name: 'teacherId', required: false, type: Number })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        teacher: { id: 7, fullName: 'Aziz Karimov' },
        month: '2026-11',
        totals: {
          groupsCount: 3,
          studentsCount: 41,
          paidCount: 20,
          partialCount: 6,
          unpaidCount: 15,
          amountDue: 24600000,
          amountPaid: 15800000,
          debt: 8800000,
          pendingAmount: 600000,
          totalDebt: 11200000,
          attendance: {
            present: 310,
            late: 22,
            absent: 40,
            excused: 8,
            rate: 87.4,
          },
        },
        earning: {
          baseSalary: 0,
          commission: 6320000,
          carryOver: 0,
          total: 6320000,
        },
        groups: [],
        trend: [
          {
            month: '2026-06',
            amountDue: 0,
            amountPaid: 0,
            attendanceRate: null,
          },
        ],
        debtors: [],
      },
    },
  })
  dashboard(
    @Req() req: any,
    @Query('month') month?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return this.service.getDashboard(req.user, {
      month,
      teacherId: teacherId ? Number(teacherId) : undefined,
    });
  }
}
