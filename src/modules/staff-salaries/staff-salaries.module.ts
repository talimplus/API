import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffSalaryPayment } from '@/modules/staff-salaries/entities/staff-salary-payment.entity';
import { StaffDeduction } from '@/modules/staff-salaries/entities/staff-deduction.entity';
import { StaffSalaryDeduction } from '@/modules/staff-salaries/entities/staff-salary-deduction.entity';
import { PaymentReceipt } from '@/modules/payments/entities/payment-receipt.entity';
import { User } from '@/modules/users/entities/user.entity';
import { StaffSalariesService } from '@/modules/staff-salaries/staff-salaries.service';
import { StaffDeductionsService } from '@/modules/staff-salaries/staff-deductions.service';
import { StaffOverviewService } from '@/modules/staff-salaries/staff-overview.service';
import { StaffSalariesController } from '@/modules/staff-salaries/staff-salaries.controller';
import { StaffOverviewController } from '@/modules/staff-salaries/staff-overview.controller';
import { TeacherEarningsModule } from '@/modules/teacher-earnings/teacher-earnings.module';
import { StaffAttendanceModule } from '@/modules/staff-attendance/staff-attendance.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StaffSalary,
      StaffSalaryPayment,
      StaffDeduction,
      StaffSalaryDeduction,
      PaymentReceipt,
      User,
    ]),
    forwardRef(() => TeacherEarningsModule),
    StaffAttendanceModule,
  ],
  providers: [
    StaffSalariesService,
    StaffDeductionsService,
    StaffOverviewService,
  ],
  controllers: [StaffSalariesController, StaffOverviewController],
  exports: [StaffSalariesService, StaffDeductionsService],
})
export class StaffSalariesModule {}
