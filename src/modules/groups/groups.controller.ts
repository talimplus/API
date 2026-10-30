import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Delete,
  Put,
  Query,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { GroupPausesService } from './group-pauses.service';
import { GroupTimelineService } from './group-timeline.service';
import { GroupMembersService } from './group-members.service';
import { CreateGroupPauseDto } from './dto/group-pause.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaginatedGroupResponseDto } from '@/modules/groups/dto/paginated-group-response.dto';
import { GroupResponseDto } from '@/modules/groups/dto/group-response.dto';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { UserRole } from '@/common/enums/user-role.enums';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';
import { ChangeGroupStatusDto } from '@/modules/groups/dto/change-group-status.dto';
import { ApiBody } from '@nestjs/swagger';
import { PreviewGroupStartDateDto } from '@/modules/groups/dto/preview-group-start-date.dto';

@ApiTags('Groups')
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly groupPausesService: GroupPausesService,
    private readonly groupTimelineService: GroupTimelineService,
    private readonly groupMembersService: GroupMembersService,
  ) {}

  @Post()
  @RequirePermissions('groups.create')
  @ApiOperation({ summary: 'Create new group' })
  @ApiResponse({ type: GroupResponseDto })
  create(@Body() dto: CreateGroupDto, @Req() req: any) {
    return this.groupsService.create(dto, req.user.centerId, req.user.role);
  }

  @Put(':id')
  @RequirePermissions('groups.update')
  @ApiOperation({
    summary: 'Update group',
    description:
      "Guruh darslari tugash sanasi (`endDate`) shu API orqali o'zgartiriladi: " +
      "sana o'zgarsa guruh statusi va shu guruhning ochiq to'lovlari avtomatik " +
      'qayta hisoblanadi.',
  })
  @ApiResponse({ type: GroupResponseDto })
  update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupDto,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;

    return this.groupsService.update(
      id,
      dto,
      req.user.organizationId,
      isAdmin ? undefined : req.user.centerId,
    );
  }

  @Put('change-status/:id')
  @RequirePermissions('groups.changeStatus')
  @ApiOperation({ summary: 'Change group status' })
  @ApiResponse({ type: GroupResponseDto })
  @ApiQuery({ name: 'status', required: false, enum: GroupStatus })
  @ApiBody({ type: ChangeGroupStatusDto, required: false })
  async changeStatus(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('status') status?: GroupStatus,
    @Body() body?: Partial<ChangeGroupStatusDto>,
  ) {
    const effectiveStatus = (body?.status ?? status) as GroupStatus | undefined;
    return this.groupsService.changeStatus(
      req.user.organizationId,
      id,
      effectiveStatus as any,
      req.user.centerId,
      {
        startDate: body?.startDate,
        backdateStudentIds: body?.backdateStudentIds,
      },
    );
  }

  @Post(':id/start-date/preview')
  @RequirePermissions('groups.changeStatus', 'groups.update')
  @ApiOperation({
    summary: "Boshlanish sanasi o'zgarishining to'lovlarga ta'siri (preview)",
    description:
      "Hech narsa yozmaydi. `candidates` — a'zoligi ham surilishi mumkin " +
      "bo'lgan o'quvchilar; `rows` — o'zgaradigan to'lov qatorlari; " +
      "`paidSalaryMonths` — o'qituvchi oyligi berilgan oylar (carryover); " +
      "`attendanceBefore > 0` bo'lsa sana qo'llanmaydi (422).",
  })
  @ApiBody({ type: PreviewGroupStartDateDto })
  previewStartDate(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PreviewGroupStartDateDto,
  ) {
    return this.groupsService.previewStartDate(
      req.user.organizationId,
      id,
      dto,
      req.user.centerId,
    );
  }

  @Get()
  @RequirePermissions('groups.view')
  @ApiOperation({ summary: 'Get all groups' })
  @ApiResponse({ type: PaginatedGroupResponseDto })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'teacherId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      'Vergul bilan: `new,started` — faol guruhlar, `finished` — yopilgan/tugagan. Berilmasa — hammasi.',
    example: 'new,started',
  })
  findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('teacherId') teacherId?: number,
    @Query('roomId') roomId?: number,
    @Query('page') page?: number,
    @Query('days') days?: WeekDay[],
    @Query('perPage') perPage?: number,
    @Query('status') status?: string,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    const teacherID =
      req.user.role === UserRole.TEACHER ? req.user.userId : teacherId;
    return this.groupsService.findAll(
      req.user.role,
      req.user.organizationId,
      effectiveCenterId,
      name,
      teacherID,
      roomId,
      days,
      page,
      perPage,
      this.parseStatuses(status),
    );
  }

  /** `status=new,started` → [new, started]; noma'lum qiymatlar tashlanadi. */
  private parseStatuses(raw?: string): GroupStatus[] | undefined {
    if (!raw) return undefined;
    const list = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is GroupStatus =>
        (Object.values(GroupStatus) as string[]).includes(s),
      );
    return list.length ? list : undefined;
  }

  @Get(':id/members')
  @RequirePermissions('groups.view')
  @ApiOperation({
    summary: "Guruhda o'qigan BARCHA o'quvchilar (sobiqlari ham)",
    description:
      "A'zolik oynalaridan: qachon qo'shilgan/chiqqan, qaysi guruhga " +
      "ko'chirilgan, hozir shu guruhdami. `debt` (shu guruhdagi qarz) faqat " +
      '`payments.view` ruxsati bilan, aks holda null.',
  })
  members(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.groupMembersService.list(req.user, id);
  }

  @Get('/all')
  @RequirePermissions('groups.view')
  @ApiOperation({ summary: 'Get all groups (no pagination)' })
  @ApiResponse({ type: [GroupResponseDto] })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiQuery({
    name: 'teacherId',
    required: false,
    type: Number,
    description:
      'Filter groups by teacher. Ignored for TEACHER role (always scoped to self).',
  })
  async getAllGroups(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('teacherId') teacherId?: number,
  ) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    const effectiveTeacherId =
      req.user.role === UserRole.TEACHER
        ? req.user.userId
        : teacherId
          ? +teacherId
          : undefined;

    if (!effectiveCenterId) {
      return this.groupsService.getAllByOrganization(
        req.user.organizationId,
        effectiveTeacherId,
      );
    }

    return this.groupsService.getAllByOrganizationAndCenter(
      req.user.organizationId,
      effectiveCenterId,
      effectiveTeacherId,
    );
  }

  /** Admin bo'lmasa — o'z filialida qamalgan. */
  private scopedCenterId(req: any): number | undefined {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;
    return isAdmin ? undefined : req.user.centerId;
  }

  @Get(':id/timeline')
  @RequirePermissions('groups.view')
  @ApiOperation({
    summary: 'Guruh tarixi (timeline)',
    description:
      "O'qituvchi, jadval, narx almashuvlari, pauzalar, ko'chirilgan darslar va " +
      "o'quvchilar qo'shilishi/chiqishi/ko'chirilishi — yangisi tepada. " +
      '`date` — hodisa kuchga kirgan kun (narx uchun — oyning 1-sanasi).',
  })
  @ApiResponse({
    description:
      '[{ date: YYYY-MM-DD, type, title, data }] — type: group_created, group_started, ' +
      'group_finished, group_end_planned, teacher_assigned, teacher_changed, schedule_set, ' +
      'schedule_changed, fee_set, fee_changed, pause, lesson_moved, student_joined, ' +
      'student_left, student_transferred_in, student_transferred_out',
  })
  timeline(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.groupTimelineService.getTimeline(
      id,
      req.user.organizationId,
      this.scopedCenterId(req),
    );
  }

  @Get(':id/pauses')
  @RequirePermissions('groups.view')
  @ApiOperation({
    summary: "Guruhning to'xtatilgan davrlari",
    description:
      "Bu kunlardagi darslar o'tkazilmaydi: jurnalda ko'rinmaydi va to'lovga kirmaydi.",
  })
  @ApiResponse({
    description: '[{ id, groupId, fromDate, toDate, reason, createdAt }]',
  })
  listPauses(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.groupPausesService.list(
      id,
      req.user.organizationId,
      this.scopedCenterId(req),
    );
  }

  @Post(':id/pauses')
  @RequirePermissions('groups.update')
  @ApiOperation({
    summary: "Guruhni vaqtincha to'xtatish",
    description:
      "[fromDate..toDate] oralig'idagi darslar o'tkazilmaydi va o'quvchi ular " +
      "uchun to'lamaydi. Davomat yozilgan kunni to'xtatib bo'lmaydi (422). " +
      "Guruh to'lovlari darhol qayta hisoblanadi.",
  })
  @ApiBody({ type: CreateGroupPauseDto })
  @ApiResponse({
    description: '{ id, groupId, fromDate, toDate, reason, createdAt }',
  })
  createPause(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGroupPauseDto,
    @Req() req: any,
  ) {
    return this.groupPausesService.create(
      id,
      dto,
      req.user,
      this.scopedCenterId(req),
    );
  }

  @Delete(':id/pauses/:pauseId')
  @RequirePermissions('groups.update')
  @ApiOperation({
    summary: "To'xtatishni bekor qilish",
    description: "Darslar qaytadi, to'lovlar qayta hisoblanadi.",
  })
  @ApiResponse({ description: '{ success: true }' })
  removePause(
    @Param('id', ParseIntPipe) id: number,
    @Param('pauseId', ParseIntPipe) pauseId: number,
    @Req() req: any,
  ) {
    return this.groupPausesService.remove(
      id,
      pauseId,
      req.user.organizationId,
      this.scopedCenterId(req),
    );
  }

  @Get(':id')
  @RequirePermissions('groups.view')
  @ApiOperation({ summary: 'Get one group' })
  @ApiResponse({ type: GroupResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.groupsService.findOne(id, req.user.organizationId);
  }

  @Delete(':id')
  @RequirePermissions('groups.delete')
  @ApiOperation({ summary: 'Delete group' })
  @ApiResponse({ type: GroupResponseDto })
  @ApiResponse({
    status: 400,
    description:
      "Guruhda to'lov yoki davomat tarixi bor — o'chirib bo'lmaydi, " +
      'yopish (finished) kerak',
  })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.groupsService.remove(
      id,
      req.user.organizationId,
      req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN
        ? undefined
        : req.user.centerId,
    );
  }
}
