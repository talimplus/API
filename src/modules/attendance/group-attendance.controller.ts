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
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { AttendanceService } from '@/modules/attendance/attendance.service';
import { GetLessonDatesQueryDto } from '@/modules/attendance/dto/get-lesson-dates.query.dto';
import { LessonDatesViewDto } from '@/modules/attendance/dto/lesson-dates-view.dto';
import { SubmitAttendanceDto } from '@/modules/attendance/dto/submit-attendance.dto';
import { AttendanceRowDto } from '@/modules/attendance/dto/attendance-row.dto';
import { RescheduleLessonDto } from '@/modules/attendance/dto/reschedule-lesson.dto';

@ApiTags('Group Attendance')
@ApiBearerAuth('access-token')
@Controller('groups/:groupId/attendance')
export class GroupAttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('lesson-dates')
  @RequirePermissions('attendance.view')
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
  @RequirePermissions('attendance.manage')
  @ApiOperation({
    summary: 'Submit attendance (lazy creation, bulk upsert, no duplicates)',
    description:
      'Creates/updates persisted attendance facts for a specific lessonDate. ' +
      'Validates that lessonDate is a real lesson date computed from schedule (not from attendance). ' +
      'Teachers can submit for today or any past date within the current month (group timezone). Admins may override any past date. ' +
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

  @Post('reschedule')
  @RequirePermissions('attendance.manage')
  @ApiOperation({
    summary: 'Reschedule a lesson to a new date',
    description:
      "Marks today's scheduled lesson as cancelled and adds a new extra lesson (toDate). " +
      'toDate must not be a regular scheduled lesson date.',
  })
  @ApiParam({ name: 'groupId', type: Number })
  @ApiOkResponse({
    description: 'Reschedule mapping created.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid dates or conflicts with schedule/attendance.',
  })
  @ApiForbiddenResponse({ description: 'Not allowed.' })
  @ApiNotFoundResponse({ description: 'Group not found.' })
  rescheduleLesson(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: RescheduleLessonDto,
    @Req() req: any,
  ) {
    return this.attendanceService.rescheduleLesson(groupId, dto, req.user);
  }

  @Get()
  @RequirePermissions('attendance.view')
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
