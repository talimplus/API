import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';
import { SubjectsService } from './subjects.service';
import { SubjectsController } from './subjects.controller';
import { Subject } from '@/modules/subjects/entities/subjects.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subject, Center])],
  providers: [SubjectsService],
  controllers: [SubjectsController],
  exports: [SubjectsService],
})
export class SubjectsModule {}
