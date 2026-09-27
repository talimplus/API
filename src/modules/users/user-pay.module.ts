import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserPayPeriod } from '@/modules/users/entities/user-pay-period.entity';
import { UserPayService } from '@/modules/users/user-pay.service';

/**
 * Oylik/foiz tarixi — alohida kichik modul: uni `UsersModule`,
 * `TeacherEarningsModule` va `StaffSalariesModule` ishlatadi.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserPayPeriod])],
  providers: [UserPayService],
  exports: [UserPayService],
})
export class UserPayModule {}
