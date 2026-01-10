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
import { ExpensesService } from '@/modules/expenses/expenses.service';
import { CreateExpenseDto } from '@/modules/expenses/dto/create-expense.dto';
import { UpdateExpenseDto } from '@/modules/expenses/dto/update-expense.dto';
import { ExpenseResponseDto } from '@/modules/expenses/dto/expense-response.dto';
import { PaginatedExpenseResponseDto } from '@/modules/expenses/dto/paginated-expense-response.dto';
import { Roles } from '@/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enums';

@ApiTags('Expenses')
@ApiBearerAuth('access-token')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create monthly expense' })
  @ApiBody({ type: CreateExpenseDto })
  @ApiResponse({ type: ExpenseResponseDto })
  create(@Req() req: any, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(req.user.organizationId, req.user.centerId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List monthly expenses (paginated)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  @ApiQuery({ name: 'forMonth', required: false, example: '2026-01' })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({ type: PaginatedExpenseResponseDto })
  findAll(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
    @Query('forMonth') forMonth?: string,
    @Query('centerId') centerId?: number,
    @Query('search') search?: string,
  ) {
    return this.expensesService.findAll(req.user.organizationId, req.user.centerId, {
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
      forMonth,
      centerId: centerId ? +centerId : undefined,
      search,
    });
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get expense by id' })
  @ApiResponse({ type: ExpenseResponseDto })
  findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.expensesService.findOne(req.user.organizationId, id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update expense by id' })
  @ApiBody({ type: UpdateExpenseDto })
  @ApiResponse({ type: ExpenseResponseDto })
  update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.update(req.user.organizationId, req.user.centerId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete expense by id' })
  @ApiResponse({ schema: { example: { success: true } } })
  remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.expensesService.remove(req.user.organizationId, id);
  }
}

