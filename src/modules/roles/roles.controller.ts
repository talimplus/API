import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RequirePermissions } from '@/decorators/permissions.decorator';

@ApiTags('Roles')
@ApiBearerAuth('access-token')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /**
   * 📚 Ruxsatlar katalogi — frontend checkbox'larini shu ro'yxatdan chizadi.
   * Yangi ruxsat qo'shilsa, frontendda hech narsa o'zgartirilmaydi.
   */
  @Get('permissions')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'Ruxsatlar katalogi (guruhlangan)' })
  @ApiResponse({
    schema: {
      example: [
        {
          key: 'students',
          label: { uz: 'O‘quvchilar', ru: 'Ученики' },
          permissions: [
            {
              key: 'students.view',
              label: { uz: 'O‘quvchilarni ko‘rish', ru: 'Просмотр учеников' },
            },
          ],
        },
      ],
    },
  })
  getPermissions() {
    return this.rolesService.getPermissionCatalog();
  }

  @Get()
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'Markazdagi barcha rollar' })
  @ApiResponse({
    schema: {
      example: [
        {
          id: 3,
          key: 'kassir',
          name: 'Kassir',
          baseRole: 'other',
          permissions: ['payments.view', 'payments.create'],
          isSystem: false,
          isLocked: false,
          userCount: 2,
        },
      ],
    },
  })
  findAll(@Req() req: any) {
    return this.rolesService.findAll(req.user.organizationId);
  }

  @Post()
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Yangi rol yaratish' })
  @ApiBody({ type: CreateRoleDto })
  create(@Body() dto: CreateRoleDto, @Req() req: any) {
    return this.rolesService.create(dto, req.user.organizationId);
  }

  @Put(':id')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Rol nomi va ruxsatlarini o‘zgartirish' })
  @ApiBody({ type: UpdateRoleDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
    @Req() req: any,
  ) {
    return this.rolesService.update(id, dto, req.user.organizationId);
  }

  @Delete(':id')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Rolni o‘chirish (tizim rollari va band rollar o‘chmaydi)',
  })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.rolesService.remove(id, req.user.organizationId);
  }
}
