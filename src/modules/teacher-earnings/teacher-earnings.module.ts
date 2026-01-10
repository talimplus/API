import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeacherMonthlyEarning } from '@/modules/teacher-earnings/entities/teacher-monthly-earning.entity';
import { TeacherCommissionCarryOver } from '@/modules/teacher-earnings/entities/teacher-commission-carryover.entity';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { User } from '@/modules/users/entities/user.entity';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeacherMonthlyEarning,
      TeacherCommissionCarryOver,
      User,
      Payment,
      StaffSalary,
    ]),
  ],
  providers: [TeacherEarningsService],
  controllers: [],
  exports: [TeacherEarningsService],
})
export class TeacherEarningsModule {}

