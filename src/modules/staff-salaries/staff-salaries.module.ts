import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { User } from '@/modules/users/entities/user.entity';
import { StaffSalariesService } from '@/modules/staff-salaries/staff-salaries.service';
import { StaffSalariesController } from '@/modules/staff-salaries/staff-salaries.controller';
import { TeacherEarningsModule } from '@/modules/teacher-earnings/teacher-earnings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StaffSalary, User]),
    forwardRef(() => TeacherEarningsModule),
  ],
  providers: [StaffSalariesService],
  controllers: [StaffSalariesController],
  exports: [StaffSalariesService],
})
export class StaffSalariesModule {}

