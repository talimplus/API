import { Module } from '@nestjs/common';
import { Group } from '@/modules/groups/entities/groups.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Group])],
})
export class LessonsModule {}
