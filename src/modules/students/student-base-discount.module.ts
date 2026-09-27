import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentBaseDiscount } from '@/modules/students/entities/student-base-discount.entity';
import { StudentBaseDiscountService } from '@/modules/students/student-base-discount.service';

/**
 * Doimiy chegirma tarixi — alohida kichik modul (`GroupFeeModule` kabi):
 * uni ham `StudentsModule`, ham `PaymentsModule` ishlatadi, ular orasida esa
 * allaqachon `forwardRef` halqasi bor.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StudentBaseDiscount])],
  providers: [StudentBaseDiscountService],
  exports: [StudentBaseDiscountService],
})
export class StudentBaseDiscountModule {}
