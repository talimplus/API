import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { GroupPlanService } from './group-plan.service';

@ApiTags('Teacher Today')
@Controller('teachers/me')
export class TeacherTodayController {
  constructor(private readonly groupPlanService: GroupPlanService) {}

  @Get('today')
  @RequirePermissions('teacher.today')
  @ApiOperation({
    summary:
      "Bugungi darslar: guruh, vaqt, dars raqami, rejadagi mavzular (qo'llanma, dars rejasi, uy vazifasi bilan) va oldingi dars mavzulari",
    description:
      "O'qituvchi faqat o'z darslarini ko'radi va \"Keldim\" ni belgilay oladi " +
      '(`canCheckIn: true`). Admin/menejer esa filialning barcha bugungi ' +
      "darslarini o'qituvchi ismi bilan, **faqat ma'lumot sifatida** ko'radi " +
      '(`scope: "center"`, `canCheckIn: false`).',
  })
  @ApiQuery({
    name: 'centerId',
    required: false,
    type: Number,
    description:
      "Faqat admin uchun: qaysi filial darslari. Bo'sh bo'lsa — butun tashkilot. " +
      "O'qituvchiga ta'sir qilmaydi (u har doim o'z darslarini ko'radi).",
  })
  getToday(@Req() req: any, @Query('centerId') centerId?: number) {
    return this.groupPlanService.getTeacherToday(
      req.user,
      centerId ? Number(centerId) : undefined,
    );
  }
}
