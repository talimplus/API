import {
  Controller,
  Post,
  Body,
  Req,
  Get,
  Query,
  Param,
  ParseIntPipe,
  Put,
  Delete,
} from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';

@Controller('subjects')
@Roles(UserRole.ADMIN) // faqat admin ishlata oladi
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateSubjectDto) {
    return this.subjectsService.create(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.subjectsService.findAll(req.user.organizationId, {
      centerId: centerId ? +centerId : undefined,
      name,
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.subjectsService.findOne(id, req.user.centerId);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubjectDto,
    @Req() req: any,
  ) {
    return this.subjectsService.update(id, dto, req.user.centerId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.subjectsService.remove(id, req.user.centerId);
  }
}
