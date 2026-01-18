import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '@/modules/leads/entities/lead.entity';
import { LeadsController } from '@/modules/leads/leads.controller';
import { LeadsService } from '@/modules/leads/leads.service';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { StudentsModule } from '@/modules/students/students.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, Center, Organization, Group]),
    forwardRef(() => StudentsModule),
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}

