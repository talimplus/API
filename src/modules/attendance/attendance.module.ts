import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from './entities/attendance.entity';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { StudentsModule } from '@/modules/students/students.module';
import { GroupsModule } from '@/modules/groups/groups.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attendance]),
    forwardRef(() => StudentsModule),
    forwardRef(() => GroupsModule),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
