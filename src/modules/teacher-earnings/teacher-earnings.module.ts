import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeacherMonthlyEarning } from '@/modules/teacher-earnings/entities/teacher-monthly-earning.entity';
import { TeacherCommissionCarryOver } from '@/modules/teacher-earnings/entities/teacher-commission-carryover.entity';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { User } from '@/modules/users/entities/user.entity';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { UserPayModule } from '@/modules/users/user-pay.module';
import { StaffSalariesModule } from '@/modules/staff-salaries/staff-salaries.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeacherMonthlyEarning,
      TeacherCommissionCarryOver,
      User,
      Payment,
      StaffSalary,
    ]),
    UserPayModule,
    // Daromad o'zgarsa oylikka avans/jarimalar qayta qo'llanadi (resync)
    forwardRef(() => StaffSalariesModule),
  ],
  providers: [TeacherEarningsService],
  controllers: [],
  exports: [TeacherEarningsService],
})
export class TeacherEarningsModule {}
