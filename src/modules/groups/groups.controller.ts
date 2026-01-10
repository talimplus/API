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
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaginatedGroupResponseDto } from '@/modules/groups/dto/paginated-group-response.dto';
import { GroupResponseDto } from '@/modules/groups/dto/group-response.dto';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { UserRole } from '@/common/enums/user-role.enums';
// import { Roles } from '@/decorators/roles.decorator';
// import { UserRole } from '@/common/enums/user-role.enums';

@ApiTags('Groups')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  // @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create new group' })
  @ApiResponse({ type: GroupResponseDto })
  create(@Body() dto: CreateGroupDto, @Req() req: any) {
    return this.groupsService.create(dto, req.user.centerId, req.user.role);
  }

  @Put(':id')
  // @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update group' })
  @ApiResponse({ type: GroupResponseDto })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupDto) {
    return this.groupsService.update(id, dto);
  }

  @Get()
  // @Roles(UserRole.ADMIN, UserRole.TEACHER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all groups' })
  @ApiResponse({ type: PaginatedGroupResponseDto })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
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
      req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN;

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
  @ApiOperation({ summary: 'Get all groups (no pagination)' })
  @ApiResponse({ type: [GroupResponseDto] })
  @ApiQuery({ name: 'centerId', required: false })
  async getAllGroups(@Req() req: any, @Query('centerId') centerId?: number) {
    const isAdmin =
      req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    if (!effectiveCenterId) {
      return this.groupsService.getAllByOrganization(req.user.organizationId);
    }

    return this.groupsService.getAllByOrganizationAndCenter(
      req.user.organizationId,
      effectiveCenterId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one group' })
  @ApiResponse({ type: GroupResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.groupsService.findOne(id);
  }

  @Delete(':id')
  // @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete group' })
  @ApiResponse({ type: GroupResponseDto })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.groupsService.remove(id);
  }
}
