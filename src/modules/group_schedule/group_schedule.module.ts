import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupSchedule } from './entities/group-schedule.entity';
import { GroupScheduleService } from './group_schedule.service';
import { GroupScheduleController } from './group_schedule.controller';
import { GroupsModule } from '@/modules/groups/groups.module';
import { Group } from '@/modules/groups/entities/groups.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([GroupSchedule, Group]),
    forwardRef(() => GroupsModule),
  ],
  controllers: [GroupScheduleController],
  providers: [GroupScheduleService],
  exports: [GroupScheduleService],
})
export class GroupScheduleModule {}
