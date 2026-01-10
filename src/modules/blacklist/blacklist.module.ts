import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlacklistedToken } from '@/modules/blacklist/entities/blacklisted-token.entity';
import { BlacklistService } from '@/modules/blacklist/blacklist.service';

@Module({
  imports: [TypeOrmModule.forFeature([BlacklistedToken])],
  providers: [BlacklistService],
  exports: [BlacklistService],
})
export class BlacklistModule {}
