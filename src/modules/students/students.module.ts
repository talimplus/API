import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { StudentsService } from '@/modules/students/students.service';
import { StudentsController } from './students.controller';
import { CentersModule } from '@/modules/centers/centers.module';
import { UsersModule } from '@/modules/users/users.module';
import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { GroupsModule } from '@/modules/groups/groups.module';
import { ReferralsModule } from '@/modules/referrals/referrals.module';
import { AttendanceModule } from '@/modules/attendance/attendance.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { StudentDiscountPeriod } from '@/modules/students/entities/student-discount-period.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, Group, StudentDiscountPeriod]),
    CentersModule,
    UsersModule,
    OrganizationsModule,
    forwardRef(() => GroupsModule),
    forwardRef(() => ReferralsModule),
    forwardRef(() => AttendanceModule),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
