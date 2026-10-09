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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { CandidatesService } from '@/modules/candidates/candidates.service';
import {
  CandidateResponseDto,
  CreateCandidateDto,
  QueryCandidatesDto,
  UpdateCandidateDto,
} from '@/modules/candidates/dto/candidate.dto';
import { PaginatedCandidateResponseDto } from '@/modules/candidates/dto/paginated-candidate-response.dto';

@ApiTags('Candidates (HR)')
@ApiBearerAuth('access-token')
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get()
  @RequirePermissions('candidates.view')
  @ApiOperation({
    summary: 'Ishga nomzodlar ro‘yxati',
    description:
      'Admin `centerId` bilan filialni tanlaydi (bo‘lmasa — butun tashkilot), ' +
      'qolgan xodim faqat o‘z filialini ko‘radi. `search` — ism/familiya/telefon.',
  })
  @ApiOkResponse({ type: PaginatedCandidateResponseDto })
  list(@Query() query: QueryCandidatesDto, @Req() req: any) {
    return this.candidatesService.list(req.user, query);
  }

  @Get(':id')
  @RequirePermissions('candidates.view')
  @ApiOperation({ summary: 'Nomzod' })
  @ApiOkResponse({ type: CandidateResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.candidatesService.findOne(req.user, id);
  }

  @Post()
  @RequirePermissions('candidates.manage')
  @ApiOperation({
    summary: 'Nomzod qo‘shish',
    description:
      'Majburiy: familiya, ism, telefon, tajriba, tug‘ilgan yil. ' +
      'Fan tanlansa — nomzod filialining fani bo‘lishi kerak (422 `subjectId`).',
  })
  @ApiBody({ type: CreateCandidateDto })
  @ApiOkResponse({ type: CandidateResponseDto })
  create(@Body() dto: CreateCandidateDto, @Req() req: any) {
    return this.candidatesService.create(req.user, dto);
  }

  @Put(':id')
  @RequirePermissions('candidates.manage')
  @ApiOperation({ summary: 'Nomzodni tahrirlash' })
  @ApiBody({ type: UpdateCandidateDto })
  @ApiOkResponse({ type: CandidateResponseDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCandidateDto,
    @Req() req: any,
  ) {
    return this.candidatesService.update(req.user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('candidates.manage')
  @ApiOperation({ summary: 'Nomzodni o‘chirish' })
  @ApiOkResponse({ description: '{ success: true }' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.candidatesService.remove(req.user, id);
  }
}
