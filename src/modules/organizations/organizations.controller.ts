import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { OrganizationBrandingDto } from './dto/branding-response.dto';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * Kabinet brendingi. **Ruxsat talab qilinmaydi** — sidebar logosi va tab
   * sarlavhasi shundan chiziladi, ya'ni har bir xodimga kerak.
   * `:id` qoidasidan oldin turishi shart (aks holda `branding` id deb o'qiladi).
   */
  @Get('branding')
  @ApiOperation({ summary: 'O‘quv markazi nomi, logotipi va favicon’i' })
  @ApiResponse({ type: OrganizationBrandingDto })
  getBranding(@Req() req: any) {
    return this.organizationsService.getBranding(req.user.organizationId);
  }

  @Put('branding')
  @RequirePermissions('organization.settings')
  @ApiOperation({
    summary: 'Brendingni o‘zgartirish',
    description:
      'Rasm `data:image/...;base64,...` yoki `https://...` bo‘lishi mumkin. ' +
      'Bo‘sh satr yuborilsa rasm olib tashlanadi.',
  })
  @ApiResponse({ type: OrganizationBrandingDto })
  updateBranding(@Body() dto: UpdateBrandingDto, @Req() req: any) {
    return this.organizationsService.updateBranding(
      req.user.organizationId,
      dto,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.organizationsService.findById(id);
  }
}
