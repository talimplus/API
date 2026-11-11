import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatisticsController } from '@/modules/statistics/statistics.controller';
import { StatisticsService } from '@/modules/statistics/statistics.service';
import { TeacherDashboardController } from '@/modules/statistics/teacher-dashboard.controller';
import { TeacherDashboardService } from '@/modules/statistics/teacher-dashboard.service';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { PaymentReceipt } from '@/modules/payments/entities/payment-receipt.entity';
import { Expense } from '@/modules/expenses/entities/expenses.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { Center } from '@/modules/centers/entities/centers.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      PaymentReceipt,
      Expense,
      Student,
      StaffSalary,
      Center,
    ]),
  ],
  controllers: [StatisticsController, TeacherDashboardController],
  providers: [StatisticsService, TeacherDashboardService],
})
export class StatisticsModule {}
