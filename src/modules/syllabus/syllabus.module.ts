import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Syllabus } from './entities/syllabus.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { GroupLessonTopic } from './entities/group-lesson-topic.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { AttendanceLessonOverride } from '@/modules/attendance/entities/attendance-lesson-override.entity';
import { SyllabusController } from './syllabus.controller';
import { GroupPlanController } from './group-plan.controller';
import { TeacherTodayController } from './teacher-today.controller';
import { SyllabusService } from './syllabus.service';
import { GroupPlanService } from './group-plan.service';
import { LessonAiService } from './lesson-ai.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Syllabus,
      SyllabusTopic,
      GroupLessonTopic,
      Group,
      Subject,
      AttendanceLessonOverride,
    ]),
  ],
  controllers: [
    SyllabusController,
    GroupPlanController,
    TeacherTodayController,
  ],
  providers: [SyllabusService, GroupPlanService, LessonAiService],
  exports: [SyllabusService, GroupPlanService],
})
export class SyllabusModule {}
