import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { AttendanceAbsencesService } from '@/modules/attendance/attendance-absences.service';
import {
  AbsenceFollowUpDto,
  QueryAbsencesDto,
} from '@/modules/attendance/dto/query-absences.dto';

@ApiTags('Attendance Absences')
@ApiBearerAuth('access-token')
@Controller('attendance/absences')
export class AttendanceAbsencesController {
  constructor(private readonly absencesService: AttendanceAbsencesService) {}

  @Get()
  @RequirePermissions('attendance.view')
  @ApiOperation({
    summary: "Kelmagan o'quvchilar ro'yxati (qabulxona uchun)",
    description:
      "Barcha guruhlar bo'yicha `absent` (sababsiz) va `excused` (sababli) " +
      "davomat qatorlari. Filtr: sana oralig'i, guruh, o'qituvchi, tur, " +
      "qo'ng'iroq qilingan/qilinmagan, o'quvchi ismi/telefoni. " +
      "`absencesInRange` — shu oraliqda o'quvchi shu guruhda necha marta kelmagani. " +
      "`summary` — status va qo'ng'iroq filtrlarisiz umumiy sonlar.",
  })
  @ApiOkResponse({
    description:
      '{ data: AbsenceRow[], meta: { total, page, perPage, totalPages }, ' +
      'summary: { absent, excused, notFollowedUp } }',
  })
  list(@Query() query: QueryAbsencesDto, @Req() req: any) {
    return this.absencesService.list(req.user, query);
  }

  @Put(':id/follow-up')
  @RequirePermissions('attendance.manage')
  @ApiOperation({
    summary: "Qo'ng'iroq natijasini yozish",
    description:
      "Kelmagan o'quvchiga qo'ng'iroq qilingach sababini yozadi. Bo'sh `note` " +
      "yuborilsa belgi olib tashlanadi (qayta \"qo'ng'iroq qilinmagan\" bo'ladi).",
  })
  @ApiBody({ type: AbsenceFollowUpDto })
  @ApiOkResponse({ description: '{ id, followUpNote, followedUpAt }' })
  @ApiNotFoundResponse({ description: 'Davomat yozuvi topilmadi' })
  followUp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AbsenceFollowUpDto,
    @Req() req: any,
  ) {
    return this.absencesService.followUp(req.user, id, dto);
  }
}
