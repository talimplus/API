import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from './entities/attendance.entity';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { StudentsModule } from '@/modules/students/students.module';
import { GroupsModule } from '@/modules/groups/groups.module';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attendance, Student, Group]),
    forwardRef(() => StudentsModule),
    forwardRef(() => GroupsModule),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
