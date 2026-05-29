import {
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  Body,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GroupScheduleService } from './group_schedule.service';
import { CreateGroupScheduleDto } from './dto/create-group-schedule.dto';
import { UpdateGroupScheduleDto } from './dto/update-group-schedule.dto';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';

@ApiTags('Group Schedule')
@Controller('group-schedule')
export class GroupScheduleController {
  constructor(private readonly groupScheduleService: GroupScheduleService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create group schedule' })
  create(@Body() dto: CreateGroupScheduleDto, @Req() req: any) {
    return this.groupScheduleService.create(dto, req.user.organizationId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.TEACHER)
  @ApiOperation({ summary: 'Get all schedules' })
  findAll(@Req() req: any) {
    return this.groupScheduleService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.TEACHER)
  @ApiOperation({ summary: 'Get one schedule' })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.groupScheduleService.findOne(id, req.user.organizationId);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update schedule' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupScheduleDto,
    @Req() req: any,
  ) {
    return this.groupScheduleService.update(id, dto, req.user.organizationId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete schedule' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.groupScheduleService.remove(id, req.user.organizationId);
  }
}
