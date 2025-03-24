import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  ParseIntPipe,
  Req,
  Query,
  Put,
  Delete,
} from '@nestjs/common';
import { CentersService } from './centers.service';
import { CreateCenterDto } from './dto/create-center.dto';
import { UpdateCenterDto } from './dto/update-center.dto';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';

@Controller('centers')
export class CentersController {
  constructor(private readonly centersService: CentersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateCenterDto, @Req() req: any) {
    return this.centersService.create(dto, req.user.organizationId);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  async findAll(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
    @Query('name') name?: string,
  ) {
    return this.centersService.findAll(req.user.organizationId, {
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
      name,
    });
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.centersService.findOne(id, req.user.organizationId);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCenterDto,
    @Req() req: any,
  ) {
    return this.centersService.update(id, dto, req.user.organizationId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.centersService.remove(id, req.user.organizationId);
  }
}
