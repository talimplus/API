import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { GroupPause } from '@/modules/groups/entities/group-pause.entity';
import { CreateGroupPauseDto } from '@/modules/groups/dto/group-pause.dto';
import { PaymentsService } from '@/modules/payments/payments.service';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { dayjs } from '@/shared/utils/dayjs';

/**
 * Guruhni vaqtincha to'xtatish.
 *
 * To'xtatilgan kunlardagi darslar o'tkazilmaydi va to'lovga kirmaydi.
 * Qoidalar:
 * - sabab majburiy; davrlar bir-biri bilan kesishmaydi;
 * - davomat yozilgan kunni to'xtatib bo'lmaydi (dars allaqachon o'tgan);
 * - qo'shilganda ham, o'chirilganda ham guruh to'lovlari qayta hisoblanadi
 *   (to'liq to'langan oy ham: qo'shilsa — ortiqcha pul qaytariladigan bo'ladi,
 *   o'chirilsa — qarz qaytadi).
 */
@Injectable()
export class GroupPausesService {
  private readonly logger = new Logger(GroupPausesService.name);

  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(GroupPause)
    private readonly pauseRepo: Repository<GroupPause>,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  private async getGroup(
    groupId: number,
    organizationId: number,
    centerId?: number,
  ): Promise<Group> {
    const group = await this.groupRepo.findOne({
      where: { id: groupId },
      relations: ['center'],
    });
    if (!group || group.center?.organizationId !== organizationId) {
      throw new NotFoundException('Group not found');
    }
    if (centerId && group.center?.id !== centerId) {
      throw new NotFoundException('Group not found');
    }
    return group;
  }

  private toView(p: GroupPause) {
    return {
      id: p.id,
      groupId: p.groupId,
      fromDate: dayjs(p.fromDate).format('YYYY-MM-DD'),
      toDate: dayjs(p.toDate).format('YYYY-MM-DD'),
      reason: p.reason,
      createdAt: p.createdAt,
    };
  }

  async list(groupId: number, organizationId: number, centerId?: number) {
    await this.getGroup(groupId, organizationId, centerId);
    const rows = await this.pauseRepo.find({
      where: { groupId },
      order: { fromDate: 'DESC' },
    });
    return rows.map((p) => this.toView(p));
  }

  async create(
    groupId: number,
    dto: CreateGroupPauseDto,
    user: { organizationId: number; userId: number },
    centerId?: number,
  ) {
    await this.getGroup(groupId, user.organizationId, centerId);
    const { fromDate, toDate } = dto;
    if (toDate < fromDate) {
      throw new ValidationException({
        toDate: "Tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas",
      });
    }

    const overlap = await this.pauseRepo
      .createQueryBuilder('p')
      .where('p.groupId = :groupId', { groupId })
      .andWhere('p.fromDate <= :toDate AND p.toDate >= :fromDate', {
        fromDate,
        toDate,
      })
      .getOne();
    if (overlap) {
      throw new ValidationException({
        fromDate: `Bu davr boshqa to'xtatish bilan kesishadi (${dayjs(
          overlap.fromDate,
        ).format(
          'DD.MM.YYYY',
        )} – ${dayjs(overlap.toDate).format('DD.MM.YYYY')})`,
      });
    }

    const [marked] = await this.pauseRepo.manager.query(
      `SELECT TO_CHAR(MIN("lessonDate"), 'DD.MM.YYYY') AS "first"
         FROM "attendance"
        WHERE "groupId" = $1 AND "lessonDate" BETWEEN $2::date AND $3::date`,
      [groupId, fromDate, toDate],
    );
    if (marked?.first) {
      throw new ValidationException({
        fromDate: `${marked.first} kungi darsga davomat yozilgan — o'tgan darsni to'xtatib bo'lmaydi`,
      });
    }

    const saved = await this.pauseRepo.save(
      this.pauseRepo.create({
        groupId,
        fromDate: fromDate as unknown as Date,
        toDate: toDate as unknown as Date,
        reason: dto.reason.trim(),
        createdById: user.userId,
      }),
    );
    await this.recalc(groupId, false);
    return this.toView(saved);
  }

  async remove(
    groupId: number,
    pauseId: number,
    organizationId: number,
    centerId?: number,
  ) {
    await this.getGroup(groupId, organizationId, centerId);
    const pause = await this.pauseRepo.findOne({
      where: { id: pauseId, groupId },
    });
    if (!pause) throw new NotFoundException('To‘xtatish topilmadi');
    await this.pauseRepo.delete({ id: pause.id });
    // Darslar qaytdi — to'liq to'langan oylar ham yangi dars soni bo'yicha.
    await this.recalc(groupId, true);
    return { success: true };
  }

  private async recalc(groupId: number, force: boolean) {
    try {
      await this.paymentsService.recalculateOpenPaymentsForGroup(groupId, {
        maxMonthsBack: 3,
        includePaid: true,
        force,
      });
    } catch (e) {
      this.logger.warn(
        `Guruh ${groupId} to'lovlarini qayta hisoblashda xato: ${
          (e as any)?.message ?? e
        }`,
      );
    }
  }
}
