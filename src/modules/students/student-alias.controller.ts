import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StudentsService } from '@/modules/students/students.service';
import { PaginatedStudentResponseDto } from '@/modules/students/dto/paginate-student-response.dto';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { StudentReturnLikelihood } from '@/common/enums/student-return-likelihood.enum';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';
import { WeekDay } from '@/common/enums/group-schedule.enum';

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
  @ApiQuery({
    name: 'preferredTime',
    required: false,
    enum: StudentPreferredTime,
  })
  @ApiQuery({
    name: 'preferredDays',
    required: false,
    type: [String],
    description:
      'Array of preferred days (e.g., preferredDays=monday&preferredDays=tuesday)',
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
    @Query('preferredTime') preferredTime?: StudentPreferredTime,
    @Query('preferredDays') preferredDays?: string | string[],
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    // Handle preferredDays as array (can be single value or array)
    const preferredDaysArray = preferredDays
      ? Array.isArray(preferredDays)
        ? preferredDays
        : [preferredDays]
      : undefined;

    return this.studentsService.findAll(
      req.user.organizationId,
      {
        centerId: centerId ? +centerId : undefined,
        name,
        phone,
        status: status ?? StudentStatus.ACTIVE,
        groupId,
        returnLikelihood,
        preferredTime,
        preferredDays: preferredDaysArray as WeekDay[] | undefined,
        page: page ? +page : 1,
        perPage: perPage ? +perPage : 10,
      },
      req.user,
    );
  }
}

