import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentBaseDiscount } from '@/modules/students/entities/student-base-discount.entity';
import { StudentGroupFee } from '@/modules/students/entities/student-group-fee.entity';
import { StudentBaseDiscountService } from '@/modules/students/student-base-discount.service';
import { StudentGroupFeeService } from '@/modules/students/student-group-fee.service';

/**
 * Doimiy chegirma va guruhdagi shaxsiy narx tarixi — alohida kichik modul
 * (`GroupFeeModule` kabi): ularni ham `StudentsModule`, ham `PaymentsModule`
 * ishlatadi, ular orasida esa allaqachon `forwardRef` halqasi bor.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StudentBaseDiscount, StudentGroupFee])],
  providers: [StudentBaseDiscountService, StudentGroupFeeService],
  exports: [StudentBaseDiscountService, StudentGroupFeeService],
})
export class StudentBaseDiscountModule {}
