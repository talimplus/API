import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { AuditLogsService } from '@/modules/audit-logs/audit-logs.service';
import { QueryAuditLogsDto } from '@/modules/audit-logs/dto/query-audit-logs.dto';
import { ValidationException } from '@/common/exceptions/validation.exception';

@ApiTags('Audit logs')
@ApiBearerAuth('access-token')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @RequirePermissions('audit.view')
  @ApiOperation({
    summary: 'Harakatlar jurnali',
    description:
      "Tashkilotda ma'lumotni o'zgartirgan har bir so'rov (POST/PUT/PATCH/DELETE, " +
      "login/logout), yangidan eskiga. Filtrlar: sana oralig'i, xodim, bo'lim, " +
      'amal turi, natija, qidiruv. `body` bu yerda qaytmaydi — `GET /audit-logs/:id`.',
  })
  @ApiOkResponse({
    description:
      '{ data: [{ id, createdAt, actor: {id, firstName, lastName, role} | null, module, action, ' +
      'method, path, url, summary, entityId, statusCode, success, errorMessage, ip, durationMs }], ' +
      'meta: { total, page, perPage, totalPages } }',
  })
  list(@Query() query: QueryAuditLogsDto, @Req() req: any) {
    return this.auditLogs.list(req.user, query);
  }

  @Get(':id')
  @RequirePermissions('audit.view')
  @ApiOperation({
    summary: 'Jurnal yozuvi (batafsil)',
    description:
      "Ro'yxatdagi maydonlar + `params`, `query`, `body` (sirlar `[hidden]`), " +
      '`handler`, `userAgent`, `centerId`.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Yozuv' })
  findOne(@Param('id') id: string, @Req() req: any) {
    if (!/^\d{1,18}$/.test(id))
      throw new ValidationException({ id: 'id son bo‘lishi kerak' });
    return this.auditLogs.findOne(req.user, id);
  }
}
