import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';
import { GroupsService } from '@/modules/groups/groups.service';

@Injectable()
export class GroupsLifecycleService {
  private readonly logger = new Logger(GroupsLifecycleService.name);

  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly groupsService: GroupsService,
  ) {}

  /**
   * Har kuni guruhlarni avtomatik yopadi: guruh timezone'idagi bugungi kun
   * endDate'dan o'tgan bo'lsa (endDate inclusive) status = finished.
   *
   * Yopilgan guruhlarning o'quvchilari ham tekshiriladi: barcha guruhi
   * tugaganlar `finished` bo'ladi, boshqa guruhda darsi davom etayotganlar
   * `ACTIVE` bo'lib qoladi.
   */
  @Cron('0 3 * * *') // every day at 03:00
  async autoFinishGroups() {
    const finished: { id: number }[] = await this.groupRepo.query(
      `
      UPDATE "groups" g
      SET "status" = $1
      WHERE g."status" = $2
        AND g."endDate" IS NOT NULL
        AND g."endDate" < (NOW() AT TIME ZONE COALESCE(g."timezone", 'Asia/Tashkent'))::date
      RETURNING g."id"
    `,
      [GroupStatus.FINISHED, GroupStatus.STARTED],
    );

    if (!finished?.length) return;

    const ids = finished.map((r) => r.id);
    this.logger.log(`Avtomatik yopilgan guruhlar: ${ids.join(', ')}`);
    await this.groupsService.syncStudentStatusesForGroups(ids);
  }
}
