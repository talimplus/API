import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupFeePeriod } from '@/modules/groups/entities/group-fee-period.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { GroupFeeService } from '@/modules/groups/group-fee.service';

/**
 * Guruh narxi tarixi — alohida kichik modul.
 *
 * Alohida turishining sababi: uni ham `GroupsModule`, ham `PaymentsModule`
 * ishlatadi. Shu ikkisi orasida allaqachon `forwardRef` bor — narx servisini
 * ulardan biriga qo'shsak, bog'liqlik halqasi yanada chalkashadi.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GroupFeePeriod, Group])],
  providers: [GroupFeeService],
  exports: [GroupFeeService],
})
export class GroupFeeModule {}
