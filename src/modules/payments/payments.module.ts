import { Payment } from '@/modules/payments/entities/payment.entity';
import { StudentsModule } from '@/modules/students/students.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module, forwardRef } from '@nestjs/common';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Student, Group]),
    forwardRef(() => StudentsModule),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
