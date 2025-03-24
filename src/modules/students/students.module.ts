import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Group } from '@/modules/groups/entities/groups.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Center, Group])],
})
export class StudentsModule {}
