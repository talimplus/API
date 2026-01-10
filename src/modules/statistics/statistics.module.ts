import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatisticsController } from '@/modules/statistics/statistics.controller';
import { StatisticsService } from '@/modules/statistics/statistics.service';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { Expense } from '@/modules/expenses/entities/expenses.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { Center } from '@/modules/centers/entities/centers.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Expense, Student, StaffSalary, Center]),
  ],
  controllers: [StatisticsController],
  providers: [StatisticsService],
})
export class StatisticsModule {}

