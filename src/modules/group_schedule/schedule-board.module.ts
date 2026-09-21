import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupSchedule } from './entities/group-schedule.entity';
import { ScheduleBoardService } from './schedule-board.service';
import { Room } from '@/modules/rooms/entities/rooms.entity';

/**
 * Dars jadvali (panjara + bandlik tekshiruvi) — alohida kichik modul.
 *
 * `GroupFeeModule` bilan bir xil sabab: uni ham `GroupsModule` (guruh
 * saqlashda bloklash uchun), ham `GroupScheduleModule` (sahifa va oldindan
 * tekshirish endpointlari uchun) ishlatadi. Shu ikkisi orasida allaqachon
 * `forwardRef` bor — servisni ulardan biriga qo'shsak halqa chalkashadi.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GroupSchedule, Room])],
  providers: [ScheduleBoardService],
  exports: [ScheduleBoardService],
})
export class ScheduleBoardModule {}
