import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LeadsService } from '@/modules/leads/leads.service';
import { CreateLeadDto } from '@/modules/leads/dto/create-lead.dto';
import { UpdateLeadDto } from '@/modules/leads/dto/update-lead.dto';
import { LeadResponseDto } from '@/modules/leads/dto/lead-response.dto';
import { PaginatedLeadResponseDto } from '@/modules/leads/dto/paginated-lead-response.dto';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';
import { LeadStatus } from '@/modules/leads/enums/lead-status.enum';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { ChangeLeadStatusDto } from '@/modules/leads/dto/change-lead-status.dto';

@ApiTags('Leads')
@ApiBearerAuth('access-token')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
  @ApiOperation({ summary: 'List leads (paginated)' })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'phone', required: false })
  @ApiQuery({ name: 'status', required: false, enum: LeadStatus })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  @ApiResponse({ type: PaginatedLeadResponseDto })
  findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('phone') phone?: string,
    @Query('status') status?: LeadStatus,
    @Query('groupId') groupId?: number,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.leadsService.findAll(
      req.user.organizationId,
      {
        centerId: centerId ? +centerId : undefined,
        name,
        phone,
        status,
        groupId: groupId ? +groupId : undefined,
        page: page ? +page : 1,
        perPage: perPage ? +perPage : 10,
      },
      req.user,
    );
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
  @ApiOperation({ summary: 'Create lead' })
  @ApiBody({ type: CreateLeadDto })
  @ApiResponse({ type: LeadResponseDto })
  create(@Req() req: any, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto as any, req.user);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
  @ApiOperation({ summary: 'Update lead' })
  @ApiBody({ type: UpdateLeadDto })
  @ApiResponse({ type: LeadResponseDto })
  update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(req.user.organizationId, id, dto as any, req.user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
  @ApiOperation({ summary: 'Delete lead' })
  @ApiResponse({ schema: { example: { success: true } } })
  remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.leadsService.remove(req.user.organizationId, id);
  }

  @Post(':id/transfer-to-student')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
  @ApiOperation({ summary: 'Transfer lead to student (create student + mark lead converted)' })
  @ApiBody({
    type: CreateStudentDto,
    description:
      'Same body as POST /students. Lead phone will be used if phone is omitted. Lead will be marked as converted.',
  })
  @ApiResponse({ schema: { example: { success: true, studentId: 123 } } })
  transferToStudent(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStudentDto,
  ) {
    return this.leadsService.transferToStudent(req.user.organizationId, id, req.user, dto);
  }

  @Put('change-status/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.RECEPTION)
  @ApiOperation({ summary: 'Change lead status (optionally append reason into comment)' })
  @ApiBody({ type: ChangeLeadStatusDto })
  @ApiResponse({ type: LeadResponseDto })
  changeStatus(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeLeadStatusDto,
  ) {
    return this.leadsService.changeStatus(req.user.organizationId, id, dto);
  }
}

