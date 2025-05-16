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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaginatedSubjectResponseDto } from '@/modules/subjects/dto/paginated-subject-response';
import { SubjectResponseDto } from '@/modules/subjects/dto/subject-response.dto';

@ApiTags('Subjects')
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create new subject' })
  create(@Body() dto: CreateSubjectDto, @Req() req: any) {
    return this.subjectsService.create(dto, req.user.centerId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all subjects' })
  @ApiResponse({ type: PaginatedSubjectResponseDto })
  findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.subjectsService.findAll(req.user.organizationId, {
      centerId: centerId ? +centerId : req.user.centerId,
      name,
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
    });
  }

  @Get(':id')
  @ApiResponse({ type: SubjectResponseDto })
  @ApiOperation({ summary: 'Get subject by id' })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.subjectsService.findOne(id, req.user.centerId);
  }

  @Put(':id')
  @ApiResponse({ type: SubjectResponseDto })
  @ApiOperation({ summary: 'Update subject' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubjectDto,
    @Req() req: any,
  ) {
    return this.subjectsService.update(id, dto, req.user.centerId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete subject by id' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.subjectsService.remove(id, req.user.centerId);
  }
}
