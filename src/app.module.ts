import { dataSourceOptions } from 'db/data-source';
import { StudentHistoryModule } from '@/modules/student-history/student-history.module';
import { GroupScheduleModule } from '@/modules/group_schedule/group_schedule.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { AttendanceModule } from '@/modules/attendance/attendance.module';
import { ReferralsModule } from '@/modules/referrals/referrals.module';
import { BlacklistModule } from '@/modules/blacklist/blacklist.module';
import { StudentsModule } from '@/modules/students/students.module';
import { SubjectsModule } from '@/modules/subjects/subjects.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { ExpensesModule } from '@/modules/expenses/expenses.module';
import { CentersModule } from '@/modules/centers/centers.module';
import { LessonsModule } from '@/modules/lessons/lessons.module';
import { GroupsModule } from '@/modules/groups/groups.module';
import { UsersModule } from '@/modules/users/users.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { AccessGuard } from '@/guards/access.guard';
import { JwtAuthGuard } from '@/guards/auth.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    AuthModule,
    UsersModule,
    CentersModule,
    StudentsModule,
    SubjectsModule,
    GroupsModule,
    PaymentsModule,
    ExpensesModule,
    LessonsModule,
    StudentHistoryModule,
    BlacklistModule,
    SubscriptionsModule,
    OrganizationsModule,
    ReferralsModule,
    // GroupScheduleModule,
    // AttendanceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AccessGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
