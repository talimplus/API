import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Candidate } from '@/modules/candidates/entities/candidate.entity';
import { CandidatesService } from '@/modules/candidates/candidates.service';
import { CandidatesController } from '@/modules/candidates/candidates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Candidate])],
  providers: [CandidatesService],
  controllers: [CandidatesController],
})
export class CandidatesModule {}
