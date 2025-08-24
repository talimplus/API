import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { Room } from '@/modules/rooms/entities/rooms.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Room, Center])],
  providers: [RoomsService],
  controllers: [RoomsController],
  exports: [RoomsService],
})
export class RoomsModule {}
