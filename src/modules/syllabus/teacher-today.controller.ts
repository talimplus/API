import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
      "O'qituvchining bugungi darslari: guruh, vaqt, dars raqami, rejadagi mavzular (qo'llanma, dars rejasi, uy vazifasi bilan) va oldingi dars mavzulari",
  })
  getToday(@Req() req: any) {
    return this.groupPlanService.getTeacherToday(req.user);
  }
}
