import {
  Controller,
  Post,
  Body,
  Req,
  Get,
  Query,
  Param,
  ParseIntPipe,
  Put,
  Delete,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';
import { SyllabusService } from './syllabus.service';
import { CreateSyllabusDto } from './dto/create-syllabus.dto';
import { UpdateSyllabusDto } from './dto/update-syllabus.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import { ReorderTopicsDto } from './dto/reorder-topics.dto';
import { GenerateTopicContentDto } from './dto/generate-topic-content.dto';
import { AiPlanChatDto } from './dto/ai-plan-chat.dto';
import { SaveAiPlanDto } from './dto/save-ai-plan.dto';

@ApiTags('Syllabus')
@Controller('syllabuses')
export class SyllabusController {
  constructor(private readonly syllabusService: SyllabusService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Yangi kurs rejasi yaratish' })
  create(@Body() dto: CreateSyllabusDto, @Req() req: any) {
    return this.syllabusService.create(dto, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'Kurs rejalari ro\'yxati' })
  findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('subjectId') subjectId?: number,
    @Query('name') name?: string,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.syllabusService.findAll(req.user.organizationId, {
      centerId: centerId ? +centerId : req.user.centerId,
      subjectId: subjectId ? +subjectId : undefined,
      name,
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
    });
  }

  // ---------- AI bilan reja tuzish ----------

  @Post('ai/chat')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "AI bilan chat orqali kurs rejasi tuzish. Ma'lumot yetishmasa {type: 'question'}, tayyor bo'lsa {type: 'plan'} qaytaradi (saqlamaydi)",
  })
  aiPlanChat(@Body() dto: AiPlanChatDto, @Req() req: any) {
    return this.syllabusService.aiPlanChat(dto, req.user);
  }

  @Post('ai/save')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'AI tuzgan rejani mavzulari bilan birga saqlash (foydalanuvchi tasdiqlagandan keyin)',
  })
  saveAiPlan(@Body() dto: SaveAiPlanDto, @Req() req: any) {
    return this.syllabusService.saveAiPlan(dto, req.user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Kurs rejasi (mavzulari bilan)' })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.syllabusService.findOne(id, req.user);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Kurs rejasini yangilash' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSyllabusDto,
    @Req() req: any,
  ) {
    return this.syllabusService.update(id, dto, req.user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Kurs rejasini o\'chirish' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.syllabusService.remove(id, req.user);
  }

  // ---------- Mavzular ----------

  @Post(':id/topics')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Kurs rejasiga mavzu qo\'shish (oxiriga)' })
  addTopic(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTopicDto,
    @Req() req: any,
  ) {
    return this.syllabusService.addTopic(id, dto, req.user);
  }

  @Put(':id/topics/reorder')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Mavzular tartibini o\'zgartirish' })
  reorderTopics(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderTopicsDto,
    @Req() req: any,
  ) {
    return this.syllabusService.reorderTopics(id, dto, req.user);
  }

  @Put(':id/topics/:topicId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Mavzuni yangilash' })
  updateTopic(
    @Param('id', ParseIntPipe) id: number,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Body() dto: UpdateTopicDto,
    @Req() req: any,
  ) {
    return this.syllabusService.updateTopic(id, topicId, dto, req.user);
  }

  @Delete(':id/topics/:topicId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Mavzuni o\'chirish' })
  removeTopic(
    @Param('id', ParseIntPipe) id: number,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Req() req: any,
  ) {
    return this.syllabusService.removeTopic(id, topicId, req.user);
  }

  @Post(':id/topics/:topicId/generate-content')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "AI bilan mavzu uchun qo'llanma/dars rejasi/uy vazifasi qoralamasini yaratish (saqlamaydi — tahrirlab PUT bilan saqlanadi)",
  })
  generateTopicContent(
    @Param('id', ParseIntPipe) id: number,
    @Param('topicId', ParseIntPipe) topicId: number,
    @Body() dto: GenerateTopicContentDto,
    @Req() req: any,
  ) {
    return this.syllabusService.generateTopicContent(
      id,
      topicId,
      dto,
      req.user,
    );
  }
}
