import { Module } from '@nestjs/common';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CentersController } from './centers.controller';
import { CentersService } from './centers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Center, Organization])],
  controllers: [CentersController],
  providers: [CentersService],
  exports: [CentersService],
})
export class CentersModule {}
