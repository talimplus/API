import { Referral } from '@/modules/referrals/entities/referal.entity';
import { StudentsModule } from '@/modules/students/students.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module, forwardRef } from '@nestjs/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([Referral]),
    forwardRef(() => StudentsModule),
  ],
  providers: [ReferralsService],
  controllers: [ReferralsController],
  exports: [ReferralsService],
})
export class ReferralsModule {}
