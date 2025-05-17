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
// import { Roles } from '@/decorators/roles.decorator';
// import { UserRole } from '@/common/enums/user-role.enums';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  // @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateGroupDto, @Req() req: any) {
    return this.groupsService.create(dto, req.user.centerId, req.user.role);
  }

  @Put(':id')
  // @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupDto) {
    return this.groupsService.update(id, dto);
  }

  @Get()
  // @Roles(UserRole.ADMIN, UserRole.TEACHER, UserRole.MANAGER)
  findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('teacherId') teacherId?: number,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.groupsService.findAll(
      req.user.role,
      req.user.organizationId,
      centerId,
      name,
      teacherId,
      page,
      perPage,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.groupsService.findOne(id);
  }

  @Delete(':id')
  // @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.groupsService.remove(id);
  }
}
