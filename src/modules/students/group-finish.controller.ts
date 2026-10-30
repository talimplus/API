import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { RolesService } from '@/modules/roles/roles.service';
import { StudentsService } from '@/modules/students/students.service';
import { FinishGroupDto } from '@/modules/students/dto/finish-group.dto';

/**
 * Guruhni yakunlash `StudentsModule` da turadi: u ko'chirishni
 * (`StudentsService.transferStudents`) ishlatadi, `GroupsModule` esa
 * `StudentsModule` ni import qilmaydi (halqa bo'lmasligi uchun).
 */
@ApiTags('Groups')
@Controller('groups')
export class GroupFinishController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly rolesService: RolesService,
  ) {}

  @Post(':id/finish')
  @RequirePermissions('groups.changeStatus')
  @ApiOperation({
    summary:
      "Guruhni yakunlash (o'quvchilarni keyingi guruhga o'tkazish bilan)",
    description:
      "Tugash sanasi (oxirgi dars) qo'yiladi va guruh `finished` bo'ladi. " +
      '`studentIds` + `targetGroupId` berilsa — ular sanadan keyingi kundan ' +
      "shu guruhga ko'chiriladi (`students.transfer` ruxsati ham kerak); " +
      '`new` maqsad guruh avtomatik boshlanadi. Qolganlar "tugallangan" ' +
      "bo'ladi, qarzi shu guruhda qoladi. Tekshiruvlar yozishdan OLDIN.",
  })
  @ApiBody({ type: FinishGroupDto })
  async finish(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FinishGroupDto,
  ) {
    const canTransfer = await this.rolesService.userHasPermission(req.user, [
      'students.transfer',
    ]);
    return this.studentsService.finishGroup(
      req.user.organizationId,
      id,
      dto,
      req.user,
      canTransfer,
    );
  }
}
