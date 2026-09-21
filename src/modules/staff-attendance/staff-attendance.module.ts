import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { User } from '@/modules/users/entities/user.entity';
import { AttendanceLessonOverride } from '@/modules/attendance/entities/attendance-lesson-override.entity';
import { StaffAttendance } from './entities/staff-attendance.entity';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceController } from './staff-attendance.controller';

/**
 * Xodim davomati. Faqat repozitoriylarga tayanadi (boshqa modul servisi kerak
 * emas) — shuning uchun hech qanday `forwardRef` yo'q.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StaffAttendance,
      Group,
      Center,
      User,
      AttendanceLessonOverride,
    ]),
  ],
  controllers: [StaffAttendanceController],
  providers: [StaffAttendanceService],
  exports: [StaffAttendanceService],
})
export class StaffAttendanceModule {}
