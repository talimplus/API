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
import { ScheduleBoardModule } from '@/modules/group_schedule/schedule-board.module';
import { AttendanceModule } from '@/modules/attendance/attendance.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { GroupFeeModule } from '@/modules/groups/group-fee.module';
import { GroupSchedule } from '@/modules/group_schedule/entities/group-schedule.entity';
import { GroupSchedulePeriod } from '@/modules/group_schedule/entities/group-schedule-period.entity';
import { GroupTeacherPeriod } from '@/modules/groups/entities/group-teacher-period.entity';
import { GroupPause } from '@/modules/groups/entities/group-pause.entity';
import { GroupPausesService } from './group-pauses.service';
import { Room } from '@/modules/rooms/entities/rooms.entity';
import { AttendanceLessonOverride } from '@/modules/attendance/entities/attendance-lesson-override.entity';

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
      GroupSchedulePeriod,
      GroupTeacherPeriod,
      GroupPause,
      AttendanceLessonOverride,
    ]),
    GroupFeeModule,
    ScheduleBoardModule,
    forwardRef(() => GroupScheduleModule),
    forwardRef(() => AttendanceModule),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [GroupsController, GroupAliasController],
  providers: [GroupsService, GroupsLifecycleService, GroupPausesService],
  exports: [GroupsService],
})
export class GroupsModule {}
