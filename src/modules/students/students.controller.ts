import {
  Controller,
  Body,
  Req,
  Post,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Put,
} from '@nestjs/common';
import { StudentsService } from '@/modules/students/students.service';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { UpdateStudentDto } from '@/modules/students/dto/update-student.dto';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaginatedStudentResponseDto } from '@/modules/students/dto/paginate-student-response.dto';
import { StudentResponseDto } from '@/modules/students/dto/student-response.dto';

@ApiTags('Students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentService: StudentsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all students' })
  @ApiResponse({ type: PaginatedStudentResponseDto })
  async findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('phone') phone?: string,
    @Query('centerId') groupId?: number,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.studentService.findAll(req.user.organizationId, {
      centerId: centerId ? +centerId : req.user.centerId,
      name,
      phone,
      groupId,
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get student by id' })
  @ApiResponse({ type: StudentResponseDto })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.studentService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create student' })
  @ApiResponse({ type: StudentResponseDto })
  async create(@Body() dto: CreateStudentDto, @Req() req: any) {
    return this.studentService.create(
      dto,
      req.user.centerId,
      req.user.organizationId,
      req.user.role,
    );
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update student' })
  @ApiResponse({ type: StudentResponseDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.studentService.update(id, dto);
  }

  @Put('change-status/:id')
  @ApiOperation({ summary: 'Change student status' })
  @ApiResponse({ type: StudentResponseDto })
  async changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Query('status') status: StudentStatus,
  ) {
    return this.studentService.changeStatus(id, status);
  }
}
