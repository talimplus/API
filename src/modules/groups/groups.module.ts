import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupsController } from './groups.controller';
import { GroupAliasController } from './group-alias.controller';
import { GroupsService } from './groups.service';
import { GroupsLifecycleService } from './groups-lifecycle.service';
import { Group } from './entities/groups.entity';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { GroupScheduleModule } from '@/modules/group_schedule/group_schedule.module';
import { AttendanceModule } from '@/modules/attendance/attendance.module';
import { GroupSchedule } from '@/modules/group_schedule/entities/group-schedule.entity';
import { Room } from '@/modules/rooms/entities/rooms.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Group,
      Subject,
      Center,
      User,
      Student,
      Room,
      GroupSchedule,
    ]),
    forwardRef(() => GroupScheduleModule),
    forwardRef(() => AttendanceModule),
  ],
  controllers: [GroupsController, GroupAliasController],
  providers: [GroupsService, GroupsLifecycleService],
  exports: [GroupsService],
})
export class GroupsModule {}
