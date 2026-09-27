import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Holiday } from '@/modules/holidays/entities/holiday.entity';
import { HolidaysService } from '@/modules/holidays/holidays.service';
import { HolidaysController } from '@/modules/holidays/holidays.controller';
import { PaymentsModule } from '@/modules/payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Holiday]),
    forwardRef(() => PaymentsModule),
  ],
  providers: [HolidaysService],
  controllers: [HolidaysController],
})
export class HolidaysModule {}
