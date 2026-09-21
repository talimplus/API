import { PaginatedCenterResponseDto } from '@/modules/centers/dto/paginated-center-response.dto';
import { CenterResponseDto } from '@/modules/centers/dto/center-reponse.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { CreateCenterDto } from './dto/create-center.dto';
import { UpdateCenterDto } from './dto/update-center.dto';
import { CentersService } from './centers.service';
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  ParseIntPipe,
  Req,
  Query,
  Put,
  Delete,
} from '@nestjs/common';

@ApiTags('Centers')
@Controller('centers')
export class CentersController {
  constructor(private readonly centersService: CentersService) {}

  @Post()
  @RequirePermissions('centers.manage')
  @ApiOperation({ summary: 'Create new center' })
  @ApiResponse({ type: CenterResponseDto })
  create(@Body() dto: CreateCenterDto, @Req() req: any) {
    return this.centersService.create(dto, req.user.organizationId);
  }

  @Get()
  @RequirePermissions('centers.view')
  @ApiOperation({ summary: 'Get All centers' })
  @ApiResponse({ type: PaginatedCenterResponseDto })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  @ApiQuery({ name: 'name', required: false })
  async findAll(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
    @Query('name') name?: string,
  ) {
    return this.centersService.findAll(req.user.organizationId, {
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
      name,
    });
  }

  // Filiallar ro'yxati deyarli har bir sahifadagi filter select'ida kerak
  // (o'quvchilar, guruhlar, to'lovlar, lidlar...). Shuning uchun bu yerda
  // alohida ruxsat talab qilinmaydi — filiallarni BOSHQARISH esa
  // `centers.manage` bilan yopiq.
  @Get('/all')
  @ApiOperation({ summary: 'Get all centers (no pagination)' })
  @ApiResponse({ type: [CenterResponseDto] })
  async getAllCenters(@Req() req: any) {
    return this.centersService.getAllByCenters(req.user.organizationId);
  }

  @Get(':id')
  @RequirePermissions('centers.view')
  @ApiOperation({ summary: 'Get center by id' })
  @ApiResponse({ type: CenterResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.centersService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('centers.manage')
  @ApiOperation({ summary: 'Update center by id' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCenterDto) {
    return this.centersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('centers.manage')
  @ApiOperation({ summary: 'Delete center by id' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.centersService.remove(id);
  }
}
