import {
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GroupScheduleService } from './group_schedule.service';
import { CreateGroupScheduleDto } from './dto/create-group-schedule.dto';
import { UpdateGroupScheduleDto } from './dto/update-group-schedule.dto';

@ApiTags('Group Schedule')
@Controller('group-schedule')
export class GroupScheduleController {
  constructor(private readonly groupScheduleService: GroupScheduleService) {}

  @Post()
  @ApiOperation({ summary: 'Create group schedule' })
  create(@Body() dto: CreateGroupScheduleDto) {
    return this.groupScheduleService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all schedules' })
  findAll() {
    return this.groupScheduleService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one schedule' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.groupScheduleService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update schedule' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupScheduleDto,
  ) {
    return this.groupScheduleService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete schedule' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.groupScheduleService.remove(id);
  }
}
