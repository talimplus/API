import {
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  Body,
  ParseIntPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { GroupScheduleService } from './group_schedule.service';
import { ScheduleBoardService } from './schedule-board.service';
import { CreateGroupScheduleDto } from './dto/create-group-schedule.dto';
import { UpdateGroupScheduleDto } from './dto/update-group-schedule.dto';
import { CheckScheduleConflictsDto } from './dto/check-schedule-conflicts.dto';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { UserRole } from '@/common/enums/user-role.enums';

@ApiTags('Group Schedule')
@Controller('group-schedule')
export class GroupScheduleController {
  constructor(
    private readonly groupScheduleService: GroupScheduleService,
    private readonly scheduleBoardService: ScheduleBoardService,
  ) {}

  /**
   * DIQQAT: bu ikki yo'l `@Get(':id')` dan OLDIN turishi shart, aks holda
   * "board" so'zi id sifatida o'qilib ketadi.
   */
  @Get('board')
  @RequirePermissions('schedule.view')
  @ApiOperation({
    summary: 'Dars jadvali (butun hafta)',
    description:
      'Filialning xonalari va tugamagan guruhlarning barcha darslari. Front ' +
      "kunni o'zi filtrlaydi. O'qituvchi ham butun jadvalni ko'radi — xona " +
      "bandligi hamma uchun umumiy ma'lumot.",
  })
  @ApiQuery({
    name: 'centerId',
    required: false,
    type: Number,
    description: "Faqat admin uchun; bo'sh bo'lsa butun tashkilot",
  })
  board(@Req() req: any, @Query('centerId') centerId?: number) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;

    return this.scheduleBoardService.getBoard({
      organizationId: req.user.organizationId,
      centerId: isAdmin
        ? centerId
          ? Number(centerId)
          : null
        : req.user.centerId,
    });
  }

  @Post('conflicts')
  @RequirePermissions('schedule.view', 'groups.create', 'groups.update')
  @ApiOperation({
    summary: "Xona va o'qituvchi bandligini oldindan tekshirish",
    description:
      'Guruh saqlanmasdan turib chaqiriladi: forma natijani input ostida ' +
      "ko'rsatadi. Saqlashda backend baribir shu tekshiruvni qayta bajaradi.",
  })
  checkConflicts(@Req() req: any, @Body() dto: CheckScheduleConflictsDto) {
    return this.scheduleBoardService.findConflicts({
      organizationId: req.user.organizationId,
      days: dto.days,
      durationMinutes: dto.lessonDurationMinutes,
      roomId: dto.roomId ?? null,
      teacherId: dto.teacherId ?? null,
      excludeGroupId: dto.excludeGroupId ?? null,
    });
  }

  @Post()
  @RequirePermissions('schedule.manage')
  @ApiOperation({ summary: 'Create group schedule' })
  create(@Body() dto: CreateGroupScheduleDto, @Req() req: any) {
    return this.groupScheduleService.create(dto, req.user.organizationId);
  }

  @Get()
  @RequirePermissions('schedule.view')
  @ApiOperation({ summary: 'Get all schedules' })
  findAll(@Req() req: any) {
    return this.groupScheduleService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @RequirePermissions('schedule.view')
  @ApiOperation({ summary: 'Get one schedule' })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.groupScheduleService.findOne(id, req.user.organizationId);
  }

  @Put(':id')
  @RequirePermissions('schedule.manage')
  @ApiOperation({ summary: 'Update schedule' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupScheduleDto,
    @Req() req: any,
  ) {
    return this.groupScheduleService.update(id, dto, req.user.organizationId);
  }

  @Delete(':id')
  @RequirePermissions('schedule.manage')
  @ApiOperation({ summary: 'Delete schedule' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.groupScheduleService.remove(id, req.user.organizationId);
  }
}
