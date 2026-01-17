import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GroupsService } from '@/modules/groups/groups.service';
import { GroupResponseDto } from '@/modules/groups/dto/group-response.dto';
import { UserRole } from '@/common/enums/user-role.enums';

@ApiTags('Groups')
@Controller('group')
export class GroupAliasController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get('/all')
  @ApiOperation({ summary: 'Get all groups (no pagination) [alias: /group/all]' })
  @ApiResponse({ type: [GroupResponseDto] })
  @ApiQuery({ name: 'centerId', required: false })
  async getAllGroups(@Req() req: any, @Query('centerId') centerId?: number) {
    const isAdmin =
      req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId = isAdmin
      ? centerId
        ? +centerId
        : undefined
      : req.user.centerId;

    if (!effectiveCenterId) {
      return this.groupsService.getAllByOrganization(req.user.organizationId);
    }

    return this.groupsService.getAllByOrganizationAndCenter(
      req.user.organizationId,
      effectiveCenterId,
    );
  }
}

