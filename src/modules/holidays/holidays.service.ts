import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Holiday } from '@/modules/holidays/entities/holiday.entity';
import {
  CreateHolidayDto,
  QueryHolidaysDto,
} from '@/modules/holidays/dto/holiday.dto';
import { PaymentsService } from '@/modules/payments/payments.service';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { UserRole } from '@/common/enums/user-role.enums';
import { dayjs } from '@/shared/utils/dayjs';

/**
 * Bayram / dam olish kunlari.
 *
 * - Butun tashkilot (`centerId = null`) yoki bitta filial uchun.
 * - Admin filialni tanlaydi; qolgan xodim faqat o'z filialida ishlaydi
 *   (tashkilot bo'yicha bayramlarni ko'radi, lekin yarata olmaydi).
 * - Davomat yozilgan kunni bayram qilib bo'lmaydi (dars allaqachon o'tgan).
 * - Qo'shilganda/o'chirilganda tegishli guruhlarning ochiq to'lovlari qayta
 *   hisoblanadi (proratsiya darslar soniga bog'liq).
 */
@Injectable()
export class HolidaysService {
  private readonly logger = new Logger(HolidaysService.name);

  constructor(
    @InjectRepository(Holiday)
    private readonly repo: Repository<Holiday>,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  private isAdmin(user: any): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
  }

  private toView(h: Holiday) {
    return {
      id: h.id,
      centerId: h.centerId ?? null,
      fromDate: dayjs(h.fromDate).format('YYYY-MM-DD'),
      toDate: dayjs(h.toDate).format('YYYY-MM-DD'),
      name: h.name,
      createdAt: h.createdAt,
    };
  }

  async list(user: any, query: QueryHolidaysDto) {
    const centerId = this.isAdmin(user)
      ? (query.centerId ?? null)
      : (user.centerId ?? null);
    const qb = this.repo
      .createQueryBuilder('h')
      .where('h.organizationId = :organizationId', {
        organizationId: user.organizationId,
      });
    // Filial tanlangan bo'lsa: shu filialniki + butun tashkilot bayramlari.
    if (centerId) {
      qb.andWhere('(h.centerId IS NULL OR h.centerId = :centerId)', {
        centerId,
      });
    }
    if (query.year) {
      qb.andWhere('h.fromDate <= :yearEnd AND h.toDate >= :yearStart', {
        yearStart: `${query.year}-01-01`,
        yearEnd: `${query.year}-12-31`,
      });
    }
    const rows = await qb.orderBy('h.fromDate', 'DESC').getMany();
    return rows.map((h) => this.toView(h));
  }

  async create(user: any, dto: CreateHolidayDto) {
    const { fromDate, toDate } = dto;
    if (toDate < fromDate) {
      throw new ValidationException({
        toDate: "Tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas",
      });
    }
    if (!this.isAdmin(user) && !user.centerId) {
      // Filialsiz xodim butun tashkilot uchun bayram qo'ya olmaydi.
      throw new ForbiddenException(
        "Bayram qo'shish uchun filialga biriktirilgan bo'lish kerak",
      );
    }
    const centerId = this.isAdmin(user)
      ? (dto.centerId ?? null)
      : (user.centerId ?? null);
    if (centerId) {
      const [c] = await this.repo.manager.query(
        `SELECT 1 FROM "centers" WHERE "id" = $1 AND "organizationId" = $2`,
        [centerId, user.organizationId],
      );
      if (!c) throw new NotFoundException('Filial topilmadi');
    }

    // O'tgan (davomat yozilgan) darsni bayram qilib bo'lmaydi.
    const marked = await this.repo.manager.query(
      `SELECT g."name", TO_CHAR(MIN(a."lessonDate"), 'DD.MM.YYYY') AS "first"
         FROM "attendance" a
         JOIN "groups" g ON g."id" = a."groupId"
         JOIN "centers" c ON c."id" = g."centerId"
        WHERE c."organizationId" = $1
          AND ($2::int IS NULL OR c."id" = $2)
          AND a."lessonDate" BETWEEN $3::date AND $4::date
        GROUP BY g."name"
        LIMIT 3`,
      [user.organizationId, centerId, fromDate, toDate],
    );
    if (marked.length) {
      throw new ValidationException({
        fromDate:
          `Bu kunlarda davomat yozilgan darslar bor: ` +
          marked.map((m: any) => `${m.name} (${m.first})`).join(', '),
      });
    }

    const saved = await this.repo.save(
      this.repo.create({
        organizationId: user.organizationId,
        centerId,
        fromDate: fromDate as unknown as Date,
        toDate: toDate as unknown as Date,
        name: dto.name.trim(),
        createdById: user.userId,
      }),
    );
    await this.recalc(user.organizationId, centerId);
    return this.toView(saved);
  }

  async remove(user: any, id: number) {
    const row = await this.repo.findOne({
      where: { id, organizationId: user.organizationId },
    });
    if (!row) throw new NotFoundException('Bayram topilmadi');
    // Filial xodimi faqat o'z filialining bayramini o'chiradi.
    if (!this.isAdmin(user) && row.centerId !== (user.centerId ?? null)) {
      throw new NotFoundException('Bayram topilmadi');
    }
    await this.repo.delete({ id: row.id });
    await this.recalc(user.organizationId, row.centerId);
    return { success: true };
  }

  private async recalc(organizationId: number, centerId: number | null) {
    try {
      await this.paymentsService.recalculateOpenPaymentsForOrganization(
        organizationId,
        { maxMonthsBack: 3, centerId: centerId ?? undefined },
      );
    } catch (e) {
      this.logger.warn(
        `Bayramdan keyin to'lovlarni qayta hisoblashda xato: ${
          (e as any)?.message ?? e
        }`,
      );
    }
  }
}
