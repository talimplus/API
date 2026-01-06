import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from './entities/attendance.entity';
import { AttendanceService } from './attendance.service';
import { GroupAttendanceController } from './group-attendance.controller';
import { StudentsModule } from '@/modules/students/students.module';
import { GroupsModule } from '@/modules/groups/groups.module';
import { Group } from '@/modules/groups/entities/groups.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attendance, Group]),
    forwardRef(() => StudentsModule),
    forwardRef(() => GroupsModule),
  ],
  controllers: [GroupAttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
