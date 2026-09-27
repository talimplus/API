import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { HolidaysService } from '@/modules/holidays/holidays.service';
import {
  CreateHolidayDto,
  QueryHolidaysDto,
} from '@/modules/holidays/dto/holiday.dto';

@ApiTags('Holidays')
@ApiBearerAuth('access-token')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Get()
  @RequirePermissions('schedule.view', 'groups.view', 'attendance.view')
  @ApiOperation({
    summary: 'Bayram / dam olish kunlari',
    description:
      'Filial tanlansa — shu filialniki va butun tashkilot bayramlari. `year` — shu yil bilan kesishganlar.',
  })
  @ApiOkResponse({
    description: '[{ id, centerId, fromDate, toDate, name, createdAt }]',
  })
  list(@Query() query: QueryHolidaysDto, @Req() req: any) {
    return this.holidaysService.list(req.user, query);
  }

  @Post()
  @RequirePermissions('schedule.manage')
  @ApiOperation({
    summary: "Bayram kunini qo'shish",
    description:
      "Bu kunlarda hech bir guruhda dars bo'lmaydi. Oylik narx o'zgarmaydi " +
      '(bayram darslari rejadan ham chiqariladi). Davomat yozilgan kun — 422.',
  })
  @ApiBody({ type: CreateHolidayDto })
  @ApiOkResponse({
    description: '{ id, centerId, fromDate, toDate, name, createdAt }',
  })
  create(@Body() dto: CreateHolidayDto, @Req() req: any) {
    return this.holidaysService.create(req.user, dto);
  }

  @Delete(':id')
  @RequirePermissions('schedule.manage')
  @ApiOperation({ summary: "Bayram kunini o'chirish" })
  @ApiOkResponse({ description: '{ success: true }' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.holidaysService.remove(req.user, id);
  }
}
