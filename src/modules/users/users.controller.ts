import {
  Controller,
  Get,
  Param,
  Req,
  ParseIntPipe,
  Post,
  Query,
  Body,
  Delete,
  Put,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { Roles } from '@/decorators/roles.decorator';
import { UpdateUserDto } from '@/modules/users/dto/update-user.dto';
import { UserRole } from '@/common/enums/user-role.enums';
import { ApiOperation, ApiResponse, ApiTags, ApiBody } from '@nestjs/swagger';
import { PaginatedUserResponseDto } from '@/modules/users/dto/paginate-user-reponse.dto';
import { UserResponseDto } from '@/modules/users/dto/user-response.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * 🔐 Faqat admin (ya'ni markaz egasi) yangi user (teacher, manager, other) qo‘shadi
   */
  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create new user' })
  @ApiResponse({ type: UserResponseDto })
  async create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersService.create(
      dto,
      req.user.organizationId,
      req.user.role,
    );
  }

  /**
   * 📩 Email orqali foydalanuvchini topish (masalan, tizim ichida)
   */
  @Get('email/:email')
  @ApiOperation({ summary: 'Find user by email' })
  @ApiResponse({ type: UserResponseDto })
  async findOneByEmail(@Param('email') email: string) {
    return this.usersService.findByLogin(email);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update user' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ type: UserResponseDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
  }

  /**
   * 📋 Hozirgi markazdagi barcha foydalanuvchilar
   */
  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ type: PaginatedUserResponseDto })
  async findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
    @Query('phone') phone?: string,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.usersService.findAll(req.user.organizationId, {
      centerId: centerId ? +centerId : undefined,
      name,
      phone,
      page: page ? +page : 1,
      perPage: perPage ? +perPage : 10,
    });
  }

  /**
   * 🔍 ID bo‘yicha foydalanuvchini olish (faqat markazdagi bo‘lsa)
   */
  @Get(':id')
  @ApiOperation({ summary: 'Find user by id' })
  @ApiResponse({ type: UserResponseDto })
  async findOneById(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  /**
   * 🗑️ Foydalanuvchini o‘chirish (haqiqiy o‘chirish emas, remove ishlatyapsiz)
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Remove user' })
  @ApiResponse({ type: UserResponseDto })
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.usersService.remove(id, req.user);
  }
}
