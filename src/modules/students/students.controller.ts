import {
  Controller,
  Body,
  Req,
  Post,
  Get,
  Delete,
  Param,
  ParseIntPipe,
  Query,
  Put,
} from '@nestjs/common';
import { StudentsService } from '@/modules/students/students.service';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { UpdateStudentDto } from '@/modules/students/dto/update-student.dto';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { PaginatedStudentResponseDto } from '@/modules/students/dto/paginate-student-response.dto';
import { StudentResponseDto } from '@/modules/students/dto/student-response.dto';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';
import { CreateStudentDiscountPeriodDto } from '@/modules/students/dto/create-student-discount-period.dto';
import { UpdateStudentDiscountPeriodDto } from '@/modules/students/dto/update-student-discount-period.dto';
import { StudentDiscountPeriodResponseDto } from '@/modules/students/dto/student-discount-period-response.dto';
import { ApiBody } from '@nestjs/swagger';
import { instanceToPlain } from 'class-transformer';
import { StudentReturnLikelihood } from '@/common/enums/student-return-likelihood.enum';
import { ChangeStudentStatusDto } from '@/modules/students/dto/change-student-status.dto';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';
import { WeekDay } from '@/common/enums/group-schedule.enum';

@ApiTags('Students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentService: StudentsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all students' })
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
  @ApiQuery({
    name: 'subjectId',
    required: false,
    description: 'Filter by subject ID',
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
    @Query('subjectId') subjectId?: number,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    // Handle preferredDays as array (can be single value or array)
    const preferredDaysArray = preferredDays
      ? Array.isArray(preferredDays)
        ? preferredDays
        : [preferredDays]
      : undefined;

    return this.studentService.findAll(
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
        subjectId: subjectId ? +subjectId : undefined,
        page: page ? +page : 1,
        perPage: perPage ? +perPage : 10,
      },
      req.user,
    );
  }

  @Get('/all')
  @ApiOperation({ summary: 'Get all students without pagination' })
  @ApiResponse({ type: [StudentResponseDto] })
  @ApiQuery({ name: 'centerId', required: false })
  async getAllStudents(@Req() req: any, @Query('centerId') centerId?: number) {
    const isAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    const rows = effectiveCenterId
      ? await this.studentService.getAllByOrganizationAndCenter(
          req.user.organizationId,
          effectiveCenterId,
        )
      : await this.studentService.getAllByOrganization(req.user.organizationId);
    const plain: any[] = (instanceToPlain(rows) as any[]) ?? [];

    if (!isAdmin) {
      for (const r of plain) {
        delete r.passportSeries;
        delete r.passportNumber;
        delete r.jshshir;
      }
    }
    return plain;
  }

  @Get('/referrals')
  async findAllReferrals(@Req() req: any) {
    return this.studentService.getReferredStudents(
      req.user.organizationId,
      req.user.centerId,
    );
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
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.studentService.update(req.user.organizationId, id, dto);
  }

  @Put('change-status/:id')
  @ApiOperation({ summary: 'Change student status' })
  @ApiResponse({ type: StudentResponseDto })
  @ApiBody({ type: ChangeStudentStatusDto, required: false })
  async changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Query('status') status: StudentStatus,
    @Body() body?: Partial<ChangeStudentStatusDto>,
  ) {
    const effectiveStatus = (body?.status ?? status) as StudentStatus;
    return this.studentService.changeStatus(id, effectiveStatus, body);
  }

  @Get(':id/discount-periods')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List student discount periods' })
  @ApiResponse({ type: [StudentDiscountPeriodResponseDto] })
  async listDiscountPeriods(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.studentService.listDiscountPeriods(req.user.organizationId, id);
  }

  @Post(':id/discount-periods')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create student discount period' })
  @ApiBody({ type: CreateStudentDiscountPeriodDto })
  @ApiResponse({ type: StudentDiscountPeriodResponseDto })
  async createDiscountPeriod(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStudentDiscountPeriodDto,
  ) {
    return this.studentService.createDiscountPeriod(
      req.user.organizationId,
      id,
      dto,
    );
  }

  @Put(':id/discount-periods/:periodId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update student discount period' })
  @ApiBody({ type: UpdateStudentDiscountPeriodDto })
  @ApiResponse({ type: StudentDiscountPeriodResponseDto })
  async updateDiscountPeriod(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Param('periodId', ParseIntPipe) periodId: number,
    @Body() dto: UpdateStudentDiscountPeriodDto,
  ) {
    return this.studentService.updateDiscountPeriod(
      req.user.organizationId,
      id,
      periodId,
      dto,
    );
  }

  @Delete(':id/discount-periods/:periodId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete student discount period' })
  @ApiResponse({ schema: { example: { success: true } } })
  async deleteDiscountPeriod(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Param('periodId', ParseIntPipe) periodId: number,
  ) {
    return this.studentService.deleteDiscountPeriod(
      req.user.organizationId,
      id,
      periodId,
    );
  }
}
