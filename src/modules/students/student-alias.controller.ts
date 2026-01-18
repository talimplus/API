import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StudentsService } from '@/modules/students/students.service';
import { PaginatedStudentResponseDto } from '@/modules/students/dto/paginate-student-response.dto';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { StudentReturnLikelihood } from '@/common/enums/student-return-likelihood.enum';

@ApiTags('Students')
@Controller('student')
export class StudentAliasController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all students (alias: /student)' })
  @ApiResponse({ type: PaginatedStudentResponseDto })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'phone', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({
    name: 'returnLikelihood',
    required: false,
    enum: StudentReturnLikelihood,
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  async findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('phone') phone?: string,
    @Query('status') status?: StudentStatus,
    @Query('groupId') groupId?: number,
    @Query('returnLikelihood') returnLikelihood?: StudentReturnLikelihood,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.studentsService.findAll(
      req.user.organizationId,
      {
        centerId: centerId ? +centerId : undefined,
        name,
        phone,
        status: status ?? StudentStatus.ACTIVE,
        groupId,
        returnLikelihood,
        page: page ? +page : 1,
        perPage: perPage ? +perPage : 10,
      },
      req.user,
    );
  }
}

