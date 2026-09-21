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
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/decorators/permissions.decorator';
import { PaginatedRoomResponseDto } from '@/modules/rooms/dto/paginated-room-response';
import { RoomResponseDto } from '@/modules/rooms/dto/room-response.dto';

@ApiTags('Rooms')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @RequirePermissions('rooms.manage')
  @ApiOperation({ summary: 'Create new room' })
  create(@Body() dto: CreateRoomDto, @Req() req: any) {
    return this.roomsService.create(dto, req.user.centerId);
  }

  @Get()
  @RequirePermissions('rooms.view')
  @ApiOperation({ summary: 'Get all rooms' })
  @ApiResponse({ type: PaginatedRoomResponseDto })
  @ApiQuery({ name: 'centerId', required: false })
  @ApiQuery({ name: 'name', required: false })
  findAll(
    @Req() req: any,
    @Query('centerId') centerId?: number,
    @Query('name') name?: string,
  ) {
    return this.roomsService.findAll(req.user.organizationId, {
      centerId: centerId ? +centerId : req.user.centerId,
      name,
    });
  }

  @Get(':id')
  @RequirePermissions('rooms.view')
  @ApiResponse({ type: RoomResponseDto })
  @ApiOperation({ summary: 'Get room by id' })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.roomsService.findOne(id, req.user.centerId);
  }

  @Put(':id')
  @RequirePermissions('rooms.manage')
  @ApiResponse({ type: RoomResponseDto })
  @ApiOperation({ summary: 'Update room' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoomDto,
    @Req() req: any,
  ) {
    return this.roomsService.update(id, dto, req.user.centerId);
  }

  @Delete(':id')
  @RequirePermissions('rooms.manage')
  @ApiOperation({ summary: 'Delete room by id' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.roomsService.remove(id, req.user.centerId);
  }
}
