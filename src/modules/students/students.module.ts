import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Center, Group])],
  providers: [StudentsService],
  controllers: [StudentsController],
})
export class StudentsModule {}
