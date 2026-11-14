import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Candidate } from '@/modules/candidates/entities/candidate.entity';
import { CandidatesService } from '@/modules/candidates/candidates.service';
import { CandidatesController } from '@/modules/candidates/candidates.controller';
import { UsersModule } from '@/modules/users/users.module';
import { RolesModule } from '@/modules/roles/roles.module';

@Module({
  imports: [TypeOrmModule.forFeature([Candidate]), UsersModule, RolesModule],
  providers: [CandidatesService],
  controllers: [CandidatesController],
})
export class CandidatesModule {}
