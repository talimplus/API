import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatisticsController } from '@/modules/statistics/statistics.controller';
import { StatisticsService } from '@/modules/statistics/statistics.service';
import { TeacherDashboardController } from '@/modules/statistics/teacher-dashboard.controller';
import { TeacherDashboardService } from '@/modules/statistics/teacher-dashboard.service';
import { StatisticsOverviewController } from '@/modules/statistics/statistics-overview.controller';
import { StatisticsOverviewService } from '@/modules/statistics/statistics-overview.service';
import { StatisticsDetailsService } from '@/modules/statistics/statistics-details.service';
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
  controllers: [
    StatisticsController,
    StatisticsOverviewController,
    TeacherDashboardController,
  ],
  providers: [
    StatisticsService,
    StatisticsOverviewService,
    StatisticsDetailsService,
    TeacherDashboardService,
  ],
})
export class StatisticsModule {}
