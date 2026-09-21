import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentGroupEnrollment } from '@/modules/enrollments/entities/student-group-enrollment.entity';
import { EnrollmentsService } from '@/modules/enrollments/enrollments.service';

/**
 * Kichik, mustaqil modul: a'zolik oynalari uchta joyda kerak bo'ladi
 * (payments, students, attendance), shuning uchun `group-fee.module.ts`
 * namunasi bo'yicha alohida chiqarilgan — modullararo halqa hosil bo'lmaydi.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StudentGroupEnrollment])],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService, TypeOrmModule],
})
export class EnrollmentsModule {}
