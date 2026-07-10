import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';
import { GroupPlanService } from './group-plan.service';
import { AttachSyllabusDto } from './dto/attach-syllabus.dto';
import { SetLessonTopicsDto } from './dto/set-lesson-topics.dto';
import { DistributePlanDto } from './dto/distribute-plan.dto';

@ApiTags('Group Lesson Plan')
@Controller('groups/:groupId/plan')
export class GroupPlanController {
  constructor(private readonly groupPlanService: GroupPlanService) {}

  @Get()
  @ApiOperation({
    summary:
      'Guruh dars rejasi: darslar (raqam + sana) va biriktirilgan mavzular',
  })
  getPlan(@Param('groupId', ParseIntPipe) groupId: number, @Req() req: any) {
    return this.groupPlanService.getPlan(groupId, req.user);
  }

  @Put('syllabus')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Guruhga kurs rejasini biriktirish (syllabusId=null — uzish; almashtirishda eski biriktirishlar tozalanadi)',
  })
  attachSyllabus(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: AttachSyllabusDto,
    @Req() req: any,
  ) {
    return this.groupPlanService.attachSyllabus(
      groupId,
      dto.syllabusId ?? null,
      req.user,
    );
  }

  @Put('lessons/:lessonNumber/topics')
  @Roles(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.TEACHER,
  )
  @ApiOperation({
    summary:
      'Darsga mavzularni biriktirish (checkbox saqlash — shu dars uchun to\'liq ro\'yxat yuboriladi)',
  })
  setLessonTopics(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('lessonNumber', ParseIntPipe) lessonNumber: number,
    @Body() dto: SetLessonTopicsDto,
    @Req() req: any,
  ) {
    return this.groupPlanService.setLessonTopics(
      groupId,
      lessonNumber,
      dto,
      req.user,
    );
  }

  @Post('distribute')
  @Roles(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
    UserRole.TEACHER,
  )
  @ApiOperation({
    summary:
      'AI bilan mavzularni darslarga taqsimlash (mavjud reja almashtiriladi, keyin qo\'lda tahrirlash mumkin)',
  })
  distribute(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: DistributePlanDto,
    @Req() req: any,
  ) {
    return this.groupPlanService.distribute(groupId, dto, req.user);
  }
}
