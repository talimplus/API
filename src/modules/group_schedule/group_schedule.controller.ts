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
import { RequirePermissions } from '@/decorators/permissions.decorator';

@ApiTags('Group Schedule')
@Controller('group-schedule')
export class GroupScheduleController {
  constructor(private readonly groupScheduleService: GroupScheduleService) {}

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
