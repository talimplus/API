import { Payment } from '@/modules/payments/entities/payment.entity';
import { StudentsModule } from '@/modules/students/students.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module, forwardRef } from '@nestjs/common';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { TeacherEarningsModule } from '@/modules/teacher-earnings/teacher-earnings.module';
import { StudentDiscountPeriod } from '@/modules/students/entities/student-discount-period.entity';
import { Referral } from '@/modules/referrals/entities/referal.entity';
import { PaymentReceipt } from '@/modules/payments/entities/payment-receipt.entity';
import { User } from '@/modules/users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      PaymentReceipt,
      Student,
      Group,
      StudentDiscountPeriod,
      Referral,
      User,
    ]),
    forwardRef(() => StudentsModule),
    forwardRef(() => TeacherEarningsModule),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
