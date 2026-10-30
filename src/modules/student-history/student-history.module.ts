import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesModule } from '@/modules/roles/roles.module';
import { StudentEvent } from '@/modules/student-history/entities/student-event.entity';
import { StudentEventsService } from '@/modules/student-history/student-events.service';
import { StudentTimelineService } from '@/modules/student-history/student-timeline.service';
import { StudentTimelineController } from '@/modules/student-history/student-timeline.controller';
import { StudentAttendanceService } from '@/modules/student-history/student-attendance.service';

/**
 * O'quvchi tarixi. Boshqa domen modullariga bog'lanmaydi (jadvallarni xom
 * SQL bilan o'qiydi), shuning uchun `StudentsModule` va `PaymentsModule`
 * uni `forwardRef`siz import qilib `StudentEventsService` orqali yozadi.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StudentEvent]), RolesModule],
  controllers: [StudentTimelineController],
  providers: [
    StudentEventsService,
    StudentTimelineService,
    StudentAttendanceService,
  ],
  exports: [StudentEventsService],
})
export class StudentHistoryModule {}
