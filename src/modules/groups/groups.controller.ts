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

@ApiTags('Groups')
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly groupPausesService: GroupPausesService,
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
  findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('teacherId') teacherId?: number,
    @Query('roomId') roomId?: number,
    @Query('page') page?: number,
    @Query('days') days?: WeekDay[],
    @Query('perPage') perPage?: number,
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
    );
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
