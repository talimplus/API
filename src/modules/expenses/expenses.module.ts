import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Expense } from '@/modules/expenses/entities/expenses.entity';
import { ExpensesService } from '@/modules/expenses/expenses.service';
import { ExpensesController } from '@/modules/expenses/expenses.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Expense, Center])],
  providers: [ExpensesService],
  controllers: [ExpensesController],
})
export class ExpensesModule {}
