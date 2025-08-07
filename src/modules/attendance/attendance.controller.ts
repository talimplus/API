import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateAttendanceDto } from '@/modules/attendance/dto/create-attendance.dto';
import { UpdateAttendanceDto } from '@/modules/attendance/dto/update-attendance.dto';
import { AttendanceService } from '@/modules/attendance/attendance.service';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AttendanceResponseDto } from '@/modules/attendance/dto/attendance-response.dto';

@ApiTags('Attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post()
  @ApiOperation({ summary: 'Mark student attendance' })
  @ApiBody({ type: CreateAttendanceDto, isArray: true })
  create(@Body() dto: CreateAttendanceDto[]) {
    return this.attendanceService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update attendance record' })
  @ApiBody({ type: UpdateAttendanceDto, isArray: true })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.attendanceService.update(id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get attendance for group and date' })
  @ApiResponse({
    status: 200,
    description: 'Attendance list for the given group and date',
    type: AttendanceResponseDto,
    isArray: true,
    schema: {
      example: [
        {
          id: 1,
          date: '2025-08-06',
          isPresent: true,
          reason: null,
          student: {
            id: 12,
            firstName: 'Ali',
            lastName: 'Valiyev',
            phone: '+998901234567',
            birthDate: '2005-04-15',
          },
        },
      ],
    },
  })
  getByGroupAndDate(
    @Query('groupId', ParseIntPipe) groupId: number,
    @Query('date') date: string,
  ) {
    return this.attendanceService.findByGroupAndDate(groupId, date);
  }
}
