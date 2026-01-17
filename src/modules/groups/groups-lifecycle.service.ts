import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';

@Injectable()
export class GroupsLifecycleService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
  ) {}

  /**
   * Auto-finish groups daily:
   * if status=STARTED and startedAt + durationMonths months <= now => status=FINISHED
   */
  @Cron('0 3 * * *') // every day at 03:00
  async autoFinishGroups() {
    await this.groupRepo.query(
      `
      UPDATE "groups" g
      SET "status" = $1
      WHERE g."status" = $2
        AND g."durationMonths" IS NOT NULL
        AND g."startedAt" IS NOT NULL
        AND (g."startedAt" + (g."durationMonths" || ' months')::interval) <= NOW()
    `,
      [GroupStatus.FINISHED, GroupStatus.STARTED],
    );
  }
}

