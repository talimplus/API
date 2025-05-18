import { Referral } from '@/modules/referrals/entities/referal.entity';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { StudentsModule } from '@/modules/students/students.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, Referral]), StudentsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
