import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Center } from '@/modules/centers/entities/centers.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Student, Center])],
})
export class PaymentsModule {}
