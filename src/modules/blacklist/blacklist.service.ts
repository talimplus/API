import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { BlacklistedToken } from '@/modules/blacklist/entities/blacklisted-token.entity';

@Injectable()
export class BlacklistService {
  constructor(
    @InjectRepository(BlacklistedToken)
    private readonly repo: Repository<BlacklistedToken>,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async blacklistToken(args: {
    token: string;
    userId?: number;
    expiresAt: Date;
  }): Promise<void> {
    const tokenHash = this.hashToken(args.token);
    const expiresAt = args.expiresAt;

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(BlacklistedToken)
      .values({
        tokenHash,
        userId: args.userId ?? null,
        expiresAt,
      })
      .orIgnore()
      .execute();
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const tokenHash = this.hashToken(token);
    const row = await this.repo.findOne({
      where: { tokenHash },
      select: ['id', 'expiresAt'],
    });
    if (!row) return false;

    // Optionally allow natural expiry to "unblacklist" itself
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
    return true;
  }
}

