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

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * 🔐 Faqat admin (ya'ni markaz egasi) yangi user (teacher, manager, other) qo‘shadi
   */
  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  /**
   * 📩 Email orqali foydalanuvchini topish (masalan, tizim ichida)
   */
  @Get('email/:email')
  async findOneByEmail(@Param('email') email: string) {
    return this.usersService.findByEmail(email);
  }

  @Put(':id')
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
  async findOneById(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.usersService.findOne(id, req.centerId);
  }

  /**
   * 🗑️ Foydalanuvchini o‘chirish (haqiqiy o‘chirish emas, remove ishlatyapsiz)
   */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.usersService.remove(id, req.centerId, req.user);
  }
}
