import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';
import { AttendanceService } from '@/modules/attendance/attendance.service';
import { GetLessonDatesQueryDto } from '@/modules/attendance/dto/get-lesson-dates.query.dto';
import { LessonDatesViewDto } from '@/modules/attendance/dto/lesson-dates-view.dto';
import { SubmitAttendanceDto } from '@/modules/attendance/dto/submit-attendance.dto';
import { AttendanceRowDto } from '@/modules/attendance/dto/attendance-row.dto';

@ApiTags('Group Attendance')
@ApiBearerAuth('access-token')
@Controller('groups/:groupId/attendance')
export class GroupAttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('lesson-dates')
  @Roles(
    UserRole.TEACHER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
  )
  @ApiOperation({
    summary: 'Lesson dates view (schedule-driven, gaps allowed)',
    description:
      'Computes lessonDates strictly from group schedule + group start/end + group timezone. ' +
      'Also loads attendance rows for those dates if they exist. Missing attendance rows are expected and returned as exists=false.',
  })
  @ApiParam({ name: 'groupId', type: Number })
  @ApiQuery({ name: 'mode', required: false, enum: ['last', 'range'] })
  @ApiQuery({ name: 'count', required: false, type: Number })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiOkResponse({ type: LessonDatesViewDto })
  @ApiBadRequestResponse({
    description: 'Invalid date parameters or schedule.',
  })
  @ApiForbiddenResponse({ description: 'Not allowed to access this group.' })
  @ApiNotFoundResponse({ description: 'Group not found.' })
  getLessonDatesView(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Query() query: GetLessonDatesQueryDto,
    @Req() req: any,
  ) {
    return this.attendanceService.getLessonDatesView(groupId, query, req.user);
  }

  @Post('submit')
  @Roles(
    UserRole.TEACHER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
  )
  @ApiOperation({
    summary: 'Submit attendance (lazy creation, bulk upsert, no duplicates)',
    description:
      'Creates/updates persisted attendance facts for a specific lessonDate. ' +
      'Validates that lessonDate is a real lesson date computed from schedule (not from attendance). ' +
      'Teachers can submit only for today (in group timezone). Admins may override past dates. ' +
      'Upserts by unique key (groupId, studentId, lessonDate).',
  })
  @ApiParam({ name: 'groupId', type: Number })
  @ApiOkResponse({
    description: 'Upserted attendance rows for that lessonDate.',
    type: AttendanceRowDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid lessonDate (not a lesson), students not in group, or invalid payload.',
  })
  @ApiForbiddenResponse({ description: 'Not allowed or not editable.' })
  @ApiNotFoundResponse({ description: 'Group not found.' })
  submit(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: SubmitAttendanceDto,
    @Req() req: any,
  ) {
    return this.attendanceService.submitAttendance(groupId, dto, req.user);
  }

  @Get()
  @Roles(
    UserRole.TEACHER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGER,
  )
  @ApiOperation({
    summary: 'Attendance report (database-driven only)',
    description:
      'Queries the attendance table only and returns only dates where attendance rows exist. ' +
      'Lesson schedule is NOT involved here.',
  })
  @ApiParam({ name: 'groupId', type: Number })
  @ApiQuery({
    name: 'from',
    required: true,
    type: String,
    example: '2026-01-01',
  })
  @ApiQuery({ name: 'to', required: true, type: String, example: '2026-01-31' })
  @ApiOkResponse({ type: AttendanceRowDto, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid date range.' })
  @ApiForbiddenResponse({ description: 'Not allowed to access this group.' })
  @ApiNotFoundResponse({ description: 'Group not found.' })
  getReport(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
  ) {
    return this.attendanceService.getAttendanceReport(
      groupId,
      from,
      to,
      req.user,
    );
  }
}
