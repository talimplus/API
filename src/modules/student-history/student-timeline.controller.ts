import { Controller, Get, Param, ParseIntPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { StudentTimelineService } from '@/modules/student-history/student-timeline.service';
import { StudentTimelineResponseDto } from '@/modules/student-history/dto/student-timeline-response.dto';

@ApiTags('Students')
@Controller('students')
export class StudentTimelineController {
  constructor(private readonly timelineService: StudentTimelineService) {}

  @Get(':id/timeline')
  @RequirePermissions('students.view')
  @ApiOperation({
    summary: "O'quvchi tarixi (timeline)",
    description:
      "Guruhga qo'shilish/chiqish/ko'chirish, holat o'zgarishi, to'lovlar, " +
      'qaytarilgan pul, chegirmalar, Telegram va kelmagan darslar — yangidan ' +
      "eskiga. To'lov voqealari `payments.view`, davomat `attendance.view` " +
      "ruxsati bo'lsa qaytariladi.",
  })
  @ApiResponse({ status: 200, type: StudentTimelineResponseDto })
  getTimeline(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.timelineService.getTimeline(req.user, id);
  }
}
