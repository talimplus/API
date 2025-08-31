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
import { PaginatedRoomResponseDto } from '@/modules/rooms/dto/paginated-room-response';
import { RoomResponseDto } from '@/modules/rooms/dto/room-response.dto';

@ApiTags('Rooms')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ApiOperation({ summary: 'Create new room' })
  create(@Body() dto: CreateRoomDto, @Req() req: any) {
    return this.roomsService.create(dto, req.user.centerId);
  }

  @Get()
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
  @ApiResponse({ type: RoomResponseDto })
  @ApiOperation({ summary: 'Get room by id' })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.roomsService.findOne(id, req.user.centerId);
  }

  @Put(':id')
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
  @ApiOperation({ summary: 'Delete room by id' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.roomsService.remove(id, req.user.centerId);
  }
}
