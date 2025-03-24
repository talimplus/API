import { Module } from '@nestjs/common';
import { Center } from '@/modules/centers/entities/centers.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Center])],
})
export class ExpensesModule {}
