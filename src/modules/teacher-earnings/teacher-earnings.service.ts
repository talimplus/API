import { isSalaryFrozen } from '@/modules/staff-salaries/salary-math';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { StaffDeductionsService } from '@/modules/staff-salaries/staff-deductions.service';
import { returningRows } from '@/shared/utils/returning-rows';
import { TeacherMonthlyEarning } from '@/modules/teacher-earnings/entities/teacher-monthly-earning.entity';
import { TeacherCommissionCarryOver } from '@/modules/teacher-earnings/entities/teacher-commission-carryover.entity';
import { User } from '@/modules/users/entities/user.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import {
  Payment,
  PaymentStatus,
} from '@/modules/payments/entities/payment.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { UserPayService } from '@/modules/users/user-pay.service';
import { GroupTeacherPeriod } from '@/modules/groups/entities/group-teacher-period.entity';
import { computeLessonDates } from '@/modules/attendance/utils/lesson-dates';
import { ensureGroupHolidays } from '@/modules/group_schedule/schedule-periods.util';

@Injectable()
export class TeacherEarningsService {
  constructor(
    @InjectRepository(TeacherMonthlyEarning)
    private readonly earningRepo: Repository<TeacherMonthlyEarning>,
    @InjectRepository(TeacherCommissionCarryOver)
    private readonly carryRepo: Repository<TeacherCommissionCarryOver>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(StaffSalary)
    private readonly staffSalaryRepo: Repository<StaffSalary>,
    private readonly userPayService: UserPayService,
    @Inject(forwardRef(() => StaffDeductionsService))
    private readonly deductionsService: StaffDeductionsService,
  ) {}

  /** O'tkazma manbasi: to'lov qatori va uning oxirgi tasdiqlangan cheki. */
  private async carrySource(m: EntityManager, paymentId?: number) {
    if (!paymentId) return {};
    const [row] = await m.query(
      `SELECT p."id" AS "paymentId", p."studentId", p."groupId",
              (SELECT r."id" FROM "payment_receipts" r
                WHERE r."paymentId" = p."id" AND r."status" = 'confirmed'
                ORDER BY r."confirmedAt" DESC NULLS LAST, r."id" DESC LIMIT 1
              ) AS "receiptId"
         FROM "payments" p WHERE p."id" = $1`,
      [paymentId],
    );
    if (!row) return {};
    return {
      paymentId: Number(row.paymentId),
      studentId: row.studentId ? Number(row.studentId) : null,
      groupId: row.groupId ? Number(row.groupId) : null,
      receiptId: row.receiptId ? Number(row.receiptId) : null,
    };
  }

  /** Bir o'qituvchi + oy uchun carryover hisobi bitta qulf ostida. */
  private async lockMonth(m: EntityManager, teacherId: number, month: string) {
    await m.query('SELECT pg_advisory_xact_lock($1, $2)', [
      teacherId,
      Number(month.slice(0, 4) + month.slice(5, 7)),
    ]);
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Kech tushgan pul ulushini (carryover) keyingi to'lanmagan oyga qo'shadi.
   * Joriy oydan keyingi oy hali ochilmagan — u yerga yetib borsa carryover
   * qo'llanmay qoladi va o'sha oy hisoblanganda o'zi olinadi.
   */
  private async applyCarryoverToNextUnpaidEarningMonth(
    organizationId: number,
    teacherId: number,
    sourceMonth: string, // YYYY-MM-01
  ) {
    const currentStart = dayjs().startOf('month');
    for (let i = 1; i <= 12; i++) {
      const candidate = dayjs(sourceMonth).add(i, 'month').startOf('month');
      if (candidate.isAfter(currentStart)) return;
      const month = candidate.format('YYYY-MM-01');

      // eslint-disable-next-line no-await-in-loop
      if (await this.isSalaryPaidOut(teacherId, month)) continue;

      // eslint-disable-next-line no-await-in-loop
      await this.calculateTeacherEarningsForMonth(
        organizationId,
        teacherId,
        candidate.format('YYYY-MM'),
        { force: true },
      );
      return;
    }
  }

  private normalizeForMonthYM(ym?: string): string {
    if (!ym) throw new BadRequestException('forMonth is required (YYYY-MM)');
    const v = ym.trim();
    if (!/^\d{4}-\d{2}$/.test(v)) {
      throw new BadRequestException('forMonth must be in YYYY-MM format');
    }
    const monthStart = dayjs(`${v}-01`).startOf('month');
    const currentStart = dayjs().startOf('month');
    if (monthStart.isAfter(currentStart)) {
      throw new BadRequestException('Future months are not allowed');
    }
    return `${v}-01`;
  }

  /**
   * Oy — ISH oyi: `teacher_monthly_earnings.forMonth`, `staff_salaries.forMonth`
   * va o'quvchi to'lovlarining `payments.forMonth` bir xil oy. Pul keyingi oyda
   * berilsa ham oylik o'zi ishlangan oyda turadi (to'lanmagan bo'lib).
   *
   * "Berib bo'lingan" (muzlatilgan) = `isSalaryFrozen`: o'tgan oy va haqiqiy
   * pul to'lovi bilan yopilgan. Avans bilan yopilgan yoki joriy oy — muzlamaydi.
   */
  async isSalaryPaidOut(
    teacherId: number,
    month: string, // YYYY-MM-01
  ): Promise<boolean> {
    const row = await this.staffSalaryRepo.findOne({
      where: { userId: teacherId, forMonth: month as any },
    });
    return isSalaryFrozen(row);
  }

  /**
   * Guruhning o'qituvchi davrlari. Sana uchun o'qituvchi — `fromDate <= sana`
   * ga mos eng oxirgi davr, mos kelmasa eng birinchisi. Tarix bo'lmasa (eski
   * ma'lumot) `null` — chaqiruvchi hozirgi `groups.teacher` ga qaytadi.
   */
  private async loadTeacherResolver(
    groupId: number,
  ): Promise<((date: string) => number | null) | null> {
    const periods = await this.paymentRepo.manager
      .getRepository(GroupTeacherPeriod)
      .find({ where: { groupId }, order: { fromDate: 'ASC' } });
    if (!periods.length) return null;
    const list = periods.map((p) => ({
      from: dayjs(p.fromDate).format('YYYY-MM-DD'),
      teacherId: p.teacherId ?? null,
    }));
    return (date: string) => {
      let picked = list[0];
      for (const p of list) {
        if (p.from <= date) picked = p;
        else break;
      }
      return picked.teacherId;
    };
  }

  /**
   * Shu oyda guruhda dars bergan o'qituvchilar (komissiyani qayta hisoblash
   * kerak bo'lganlar). Tarix bo'lmasa — hozirgi o'qituvchi.
   */
  async teachersForGroupMonth(
    groupId: number,
    month: string, // YYYY-MM-01
  ): Promise<number[]> {
    const resolver = await this.loadTeacherResolver(groupId);
    if (!resolver) {
      const [row] = await this.paymentRepo.manager.query(
        `SELECT "teacherId" FROM "groups" WHERE "id" = $1`,
        [groupId],
      );
      return row?.teacherId ? [Number(row.teacherId)] : [];
    }
    const ids = new Set<number>();
    const start = dayjs(month).startOf('month');
    const days = start.daysInMonth();
    for (let i = 0; i < days; i++) {
      const t = resolver(start.add(i, 'day').format('YYYY-MM-DD'));
      if (t) ids.add(t);
    }
    return Array.from(ids);
  }

  /**
   * O'qituvchi komissiyasi uchun shu oyda tushgan pul (PAID + PARTIAL).
   *
   * Guruh bo'yicha o'qituvchi tarixi (`group_teacher_periods`) hisobga
   * olinadi: butun oy shu o'qituvchida bo'lsa — to'liq summa; oy o'rtasida
   * almashgan bo'lsa — har bir to'lov o'quvchining shu oydagi darslari
   * soniga qarab bo'linadi (eski o'qituvchi o'tgan darslari uchun ulushini
   * saqlaydi, o'quvchi almashuvdan keyin qo'shilgan bo'lsa — hammasi yangisiga).
   */
  private async computeCommissionAmount(
    teacherId: number,
    month: string, // YYYY-MM-01
  ): Promise<number> {
    const byGroup = await this.commissionBaseByGroup(teacherId, month);
    let total = 0;
    for (const v of byGroup.values()) total += v;
    return this.round2(total);
  }

  /**
   * Guruh bo'yicha: shu oy uchun o'quvchilardan tushgan pulning shu
   * o'qituvchiga tegishli qismi (ulush foizi qo'llanmagan). Ish haqi
   * sahifasidagi "ustama qayerdan keldi" jadvali shundan.
   */
  async commissionBaseByGroup(
    teacherId: number,
    month: string, // YYYY-MM-01
  ): Promise<Map<number, number>> {
    const manager = this.paymentRepo.manager;
    const result = new Map<number, number>();
    const add = (groupId: number, v: number) => {
      if (v > 0) result.set(groupId, (result.get(groupId) ?? 0) + v);
    };
    const groupRows: { id: number }[] = await manager.query(
      `SELECT g."id" FROM "groups" g WHERE g."teacherId" = $1
       UNION
       SELECT tp."groupId" FROM "group_teacher_periods" tp WHERE tp."teacherId" = $1`,
      [teacherId],
    );

    for (const { id: groupId } of groupRows) {
      const resolver = await this.loadTeacherResolver(Number(groupId));
      const monthStart = dayjs(month).startOf('month');
      const monthDays = Array.from(
        { length: monthStart.daysInMonth() },
        (_, i) => monthStart.add(i, 'day').format('YYYY-MM-DD'),
      );

      if (!resolver) {
        // Tarix yo'q (eski ma'lumot) — hozirgi o'qituvchi butun oyni oladi.
        const [row] = await manager.query(
          `SELECT "teacherId" FROM "groups" WHERE "id" = $1`,
          [groupId],
        );
        if (Number(row?.teacherId) === teacherId) {
          add(
            Number(groupId),
            await this.sumPaidForGroupMonth(Number(groupId), month),
          );
        }
        continue;
      }

      const owners = new Set(monthDays.map((d) => resolver(d)));
      if (!owners.has(teacherId)) continue;
      if (owners.size === 1) {
        add(
          Number(groupId),
          await this.sumPaidForGroupMonth(Number(groupId), month),
        );
        continue;
      }

      add(
        Number(groupId),
        await this.splitPaidForGroupMonth(
          Number(groupId),
          month,
          teacherId,
          resolver,
          monthDays,
        ),
      );
    }

    return result;
  }

  /**
   * Shu oyda o'qituvchi qaysi guruhlarda va oyning qancha qismida dars
   * bergan: 1 — butun oy, 0.4 — oy o'rtasida almashgan (kunlar ulushi).
   * Taxminiy oylik (kutilayotgan/to'lanmagan to'lovlar ulushi) shundan.
   */
  async groupShareFactors(
    teacherId: number,
    month: string, // YYYY-MM-01
  ): Promise<Map<number, number>> {
    const manager = this.paymentRepo.manager;
    const result = new Map<number, number>();
    const groupRows: { id: number }[] = await manager.query(
      `SELECT g."id" FROM "groups" g WHERE g."teacherId" = $1
       UNION
       SELECT tp."groupId" FROM "group_teacher_periods" tp WHERE tp."teacherId" = $1`,
      [teacherId],
    );
    const monthStart = dayjs(month).startOf('month');
    const days = Array.from({ length: monthStart.daysInMonth() }, (_, i) =>
      monthStart.add(i, 'day').format('YYYY-MM-DD'),
    );
    for (const { id } of groupRows) {
      const groupId = Number(id);
      const resolver = await this.loadTeacherResolver(groupId);
      if (!resolver) {
        const [row] = await manager.query(
          `SELECT "teacherId" FROM "groups" WHERE "id" = $1`,
          [groupId],
        );
        if (Number(row?.teacherId) === teacherId) result.set(groupId, 1);
        continue;
      }
      const mine = days.filter((d) => resolver(d) === teacherId).length;
      if (mine > 0) result.set(groupId, mine / days.length);
    }
    return result;
  }

  private async sumPaidForGroupMonth(
    groupId: number,
    month: string,
  ): Promise<number> {
    const raw = await this.paymentRepo
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amountPaid), 0)', 'sum')
      .where('p.groupId = :groupId', { groupId })
      .andWhere('p.forMonth = :forMonth', { forMonth: month })
      .andWhere('p.status IN (:...statuses)', {
        statuses: [PaymentStatus.PAID, PaymentStatus.PARTIAL],
      })
      .andWhere('p.amountPaid > 0')
      .getRawOne<{ sum: string }>();
    return Number(raw?.sum ?? 0);
  }

  /** Oy o'rtasida o'qituvchi almashgan guruh: har bir to'lovni darslar bo'yicha bo'lamiz. */
  private async splitPaidForGroupMonth(
    groupId: number,
    month: string,
    teacherId: number,
    teacherAt: (date: string) => number | null,
    monthDays: string[],
  ): Promise<number> {
    const manager = this.paymentRepo.manager;
    const payments = await this.paymentRepo
      .createQueryBuilder('p')
      .where('p.groupId = :groupId', { groupId })
      .andWhere('p.forMonth = :forMonth', { forMonth: month })
      .andWhere('p.status IN (:...statuses)', {
        statuses: [PaymentStatus.PAID, PaymentStatus.PARTIAL],
      })
      .andWhere('p.amountPaid > 0')
      .getMany();
    if (!payments.length) return 0;

    const group = await manager.getRepository(Group).findOne({
      where: { id: groupId },
      relations: ['schedules', 'schedulePeriods', 'pauses'],
    });
    if (group) await ensureGroupHolidays(manager, group);
    const lessonDates = group
      ? computeLessonDates({
          timezone: group.timezone || 'Asia/Tashkent',
          groupStartDate: dayjs(group.startDate).format('YYYY-MM-DD'),
          groupEndDate: group.endDate
            ? dayjs(group.endDate).format('YYYY-MM-DD')
            : null,
          schedules: group.schedules ?? [],
          schedulePeriods: group.schedulePeriods ?? null,
          pauses: group.pauses ?? null,
          holidays: group.holidays ?? null,
          window: {
            mode: 'range',
            from: monthDays[0],
            to: monthDays[monthDays.length - 1],
          },
        })
      : [];

    const windowRows: {
      studentId: number;
      joinedAt: Date | string;
      leftAt: Date | string | null;
    }[] = await manager.query(
      `SELECT "studentId", "joinedAt", "leftAt" FROM "student_group_enrollments"
        WHERE "groupId" = $1 AND "studentId" = ANY($2)`,
      [groupId, payments.map((p) => p.studentId)],
    );
    const windowsByStudent = new Map<
      number,
      { joinedAt: string; leftAt: string | null }[]
    >();
    for (const w of windowRows) {
      const list = windowsByStudent.get(Number(w.studentId)) ?? [];
      list.push({
        joinedAt: dayjs(w.joinedAt).format('YYYY-MM-DD'),
        leftAt: w.leftAt ? dayjs(w.leftAt).format('YYYY-MM-DD') : null,
      });
      windowsByStudent.set(Number(w.studentId), list);
    }

    let sum = 0;
    for (const p of payments) {
      const windows = windowsByStudent.get(p.studentId) ?? [];
      let dates = windows.length
        ? lessonDates.filter((d) =>
            windows.some((w) => w.joinedAt <= d && (!w.leftAt || d < w.leftAt)),
          )
        : lessonDates;
      // Dars topilmasa (jadval yo'q va h.k.) — kalendar kunlari bo'yicha.
      if (!dates.length) dates = monthDays;
      const mine = dates.filter((d) => teacherAt(d) === teacherId).length;
      sum += Number(p.amountPaid ?? 0) * (mine / dates.length);
    }
    return sum;
  }

  /**
   * O'qituvchining ish oyi uchun daromadini hisoblaydi va saqlaydi.
   * - komissiya — shu oy uchun o'quvchilardan tushgan pul (PAID + PARTIAL);
   * - oylik berib bo'lingan (PAID) oy **muzlatiladi**: undan keyin tushgan pul
   *   ulushi carryover bo'lib keyingi to'lanmagan oyga qo'shiladi;
   * - to'lanmagan oy har to'lovda qayta hisoblanadi va `staff_salaries` bilan sinxronlanadi.
   */
  async calculateTeacherEarningsForMonth(
    organizationId: number,
    teacherId: number,
    monthYM: string,
    /** `sourcePaymentId` — qayta hisobni qaysi to'lov boshlagani (o'tkazma manbasi). */
    opts?: { force?: boolean; sourcePaymentId?: number },
  ) {
    const month = this.normalizeForMonthYM(monthYM);
    const force = !!opts?.force;

    const teacher = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.organization', 'org')
      .where('u.id = :teacherId', { teacherId })
      .andWhere('org.id = :organizationId', { organizationId })
      .getOne();

    if (!teacher) throw new NotFoundException('Teacher not found');
    if (teacher.role !== UserRole.TEACHER) {
      throw new BadRequestException('User is not a teacher');
    }

    const existing = await this.earningRepo.findOne({
      where: { teacherId, forMonth: month as any },
      relations: ['teacher'],
    });
    if (existing && !force) return existing;

    // Oylik va foiz oyga bog'langan: shu OY uchun amaldagi qiymat (keyin
    // o'zgartirilgan foiz o'tgan oylarga ta'sir qilmaydi).
    const pay = await this.userPayService.getForMonth(teacher, month);
    const baseSalary = Number(pay.salary ?? 0);
    const commissionPct = Math.max(
      0,
      Math.min(100, Number(pay.commissionPercentage ?? 0)),
    );
    const grossPaid = await this.computeCommissionAmount(teacherId, month);
    // Shu oy uchun tushgan pulning to'liq ulushi (carryover ayirilmagan)
    const grossCommission = this.round2(
      Math.max(0, grossPaid * (commissionPct / 100)),
    );

    const paidOut = await this.isSalaryPaidOut(teacherId, month);

    // Oylik berib bo'lingan oy o'zgarmaydi. Kech tushgan pul ulushi — shu oydan
    // allaqachon hisoblangan (snapshot + avvalgi carryover'lar) summadan ortig'i.
    if (paidOut && existing) {
      // "Hisoblangan" summani o'qish va farqni yozish bitta qulf ostida:
      // bir vaqtda ikki qayta hisoblash (masalan chek tasdig'i + ro'yxat) bir
      // xil farqni ikki marta carryover qilib yozib yubormasligi uchun.
      const diff = await this.carryRepo.manager.transaction(async (m) => {
        await this.lockMonth(m, teacherId, month);
        const carried = await m
          .getRepository(TeacherCommissionCarryOver)
          .createQueryBuilder('c')
          .select('COALESCE(SUM(c.amount), 0)', 'sum')
          .where('c.teacherId = :teacherId', { teacherId })
          .andWhere('c.sourceForMonth = :month', { month })
          .getRawOne<{ sum: string }>();
        const counted =
          Number(existing.commissionAmount ?? 0) + Number(carried?.sum ?? 0);
        const d = this.round2(grossCommission - counted);
        if (d > 0) {
          const source = await this.carrySource(m, opts?.sourcePaymentId);
          await m.getRepository(TeacherCommissionCarryOver).save(
            m.getRepository(TeacherCommissionCarryOver).create({
              teacherId,
              sourceForMonth: month as any,
              amount: d as any,
              appliedForMonth: null,
              appliedAt: null,
              ...source,
            }),
          );
        }
        return d;
      });
      if (diff > 0) {
        await this.applyCarryoverToNextUnpaidEarningMonth(
          organizationId,
          teacherId,
          month,
        );
      }
      return existing;
    }

    // Carryover hisobi bitta qulf ostida (muzlatilgan yo'l bilan bir xil kalit).
    const carry = await this.carryRepo.manager.transaction(async (m) => {
      await this.lockMonth(m, teacherId, month);
      const repo = m.getRepository(TeacherCommissionCarryOver);

      // Shu oydan chiqib, hali hech qayerga qo'shilmagan ulushlar — oy
      // muzlatilgan paytda yozilgan. Endi oy ochiq (masalan avans bilan
      // yopilgan edi) — ular o'z oyiga qaytadi va pastdagi `gross` ichida
      // qayta sanaladi. Ikki marta sanalmaydi: qator o'chiriladi.
      if (!paidOut) {
        await m.query(
          `DELETE FROM "teacher_commission_carryovers"
            WHERE "teacherId" = $1 AND "sourceForMonth" = $2
              AND "appliedForMonth" IS NULL`,
          [teacherId, month],
        );
      }
      // Shu oydan chiqib, boshqa oyga allaqachon qo'shilgan ulush — o'sha
      // oyda to'lanadi, shu oy komissiyasidan ayiriladi (10-oy: 50% × tushum
      // − keyingi oyga o'tkazilgan 135 000).
      const out = await repo
        .createQueryBuilder('c')
        .select('COALESCE(SUM(c.amount), 0)', 'sum')
        .where('c.teacherId = :teacherId', { teacherId })
        .andWhere('c.sourceForMonth = :month', { month })
        .andWhere('c.appliedForMonth IS NOT NULL')
        .getRawOne<{ sum: string }>();

      // Carryover'lar o'zgarmas summalar; `appliedForMonth` — qaysi oyga qo'shilgani.
      // Qayta hisoblashda (force) shu oyga allaqachon qo'shilganlari saqlanadi.
      const already = await repo
        .createQueryBuilder('c')
        .select('COALESCE(SUM(c.amount), 0)', 'sum')
        .where('c.teacherId = :teacherId', { teacherId })
        .andWhere('c.appliedForMonth = :month', { month })
        .getRawOne<{ sum: string }>();

      // Hali qo'llanmagan carryover'lar — faqat o'zidan oldingi va MUZLATILGAN
      // oylardan. Ochiq oy ulushi o'z oyiga qaytadi (yuqoridagi DELETE), bu
      // yerga olinmaydi. Oylik berilgan oyga qo'shilmaydi.
      let appliedNow = 0;
      if (!paidOut) {
        const candidates = await repo
          .createQueryBuilder('c')
          .where('c.teacherId = :teacherId', { teacherId })
          .andWhere('c.appliedForMonth IS NULL')
          .andWhere('c.sourceForMonth < :month', { month })
          .orderBy('c.createdAt', 'ASC')
          .getMany();
        const frozenBySource = new Map<string, boolean>();
        const ids: number[] = [];
        for (const c of candidates) {
          const src = dayjs(c.sourceForMonth).format('YYYY-MM-01');
          if (!frozenBySource.has(src)) {
            frozenBySource.set(src, await this.isSalaryPaidOut(teacherId, src));
          }
          if (frozenBySource.get(src)) ids.push(c.id);
        }
        if (ids.length) {
          // Shartli UPDATE — parallel DELETE/UPDATE bilan bir ulush ikki joyga tushmaydi.
          const rows = returningRows<{ amount: string }>(
            await m.query(
              `UPDATE "teacher_commission_carryovers"
                  SET "appliedForMonth" = $1, "appliedAt" = NOW()
                WHERE "id" = ANY($2) AND "appliedForMonth" IS NULL
                RETURNING "amount"`,
              [month, ids],
            ),
          );
          appliedNow = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
        }
      }

      return {
        carriedOut: Number(out?.sum ?? 0),
        carryOverCommission: this.round2(
          Number(already?.sum ?? 0) + appliedNow,
        ),
      };
    });

    const commissionAmount = this.round2(
      Math.max(0, grossCommission - carry.carriedOut),
    );
    const carryOverCommission = carry.carryOverCommission;

    const totalEarning = this.round2(
      baseSalary + commissionAmount + carryOverCommission,
    );

    const snapshot =
      existing ??
      this.earningRepo.create({
        teacherId,
        teacher: teacher as any,
        forMonth: month as any,
      });

    snapshot.baseSalarySnapshot = baseSalary as any;
    snapshot.commissionAmount = commissionAmount as any;
    snapshot.carryOverCommission = carryOverCommission as any;
    snapshot.totalEarning = totalEarning as any;
    snapshot.calculatedAt = new Date();

    const savedSnapshot = await this.earningRepo.save(snapshot);

    // Muzlamagan oylik qatori daromad bilan sinxronlanadi: yangi summa, ochiq
    // avans/jarimalar sig'gancha ushlanadi, holat qayta qo'yiladi (oshsa —
    // yana "qisman/to'lanmagan"). Qulf ostida — ikki marta ushlanmaydi.
    if (!paidOut) {
      const salaryRow = await this.staffSalaryRepo.findOne({
        where: { userId: teacherId, forMonth: month as any },
      });
      if (salaryRow) {
        await this.deductionsService.resync(salaryRow.id, {
          baseSalary: Number(savedSnapshot.totalEarning ?? 0),
        });
      }
    }

    return savedSnapshot;
  }

  /**
   * `calculateTeacherEarningsForMonth({ force: true })` nima yozishini
   * hisoblaydi, lekin HECH NARSA yozmaydi (bir martalik tuzatish skriptining
   * dry-run rejimi). Oylar bir-biriga bog'liq emas: carryover faqat muzlatilgan
   * oydan olinadi, ochiq oy ulushi o'z oyida qoladi.
   */
  async previewMonth(teacherId: number, month: string /* YYYY-MM-01 */) {
    const teacher = await this.userRepo.findOne({ where: { id: teacherId } });
    if (!teacher) return null;
    const existing = await this.earningRepo.findOne({
      where: { teacherId, forMonth: month as any },
    });
    const paidOut = await this.isSalaryPaidOut(teacherId, month);
    if (paidOut) return { frozen: true as const, existing };

    const pay = await this.userPayService.getForMonth(teacher, month);
    const baseSalary = Number(pay.salary ?? 0);
    const pct = Math.max(
      0,
      Math.min(100, Number(pay.commissionPercentage ?? 0)),
    );
    const grossPaid = await this.computeCommissionAmount(teacherId, month);
    const grossCommission = this.round2(Math.max(0, grossPaid * (pct / 100)));

    const sum = async (where: string, params: unknown[]) => {
      const [row] = await this.carryRepo.manager.query(
        `SELECT COALESCE(SUM("amount"), 0) AS "sum"
           FROM "teacher_commission_carryovers"
          WHERE "teacherId" = $1 AND ${where}`,
        [teacherId, ...params],
      );
      return Number(row?.sum ?? 0);
    };
    const absorbed = await sum(
      `"sourceForMonth" = $2 AND "appliedForMonth" IS NULL`,
      [month],
    );
    const carriedOut = await sum(
      `"sourceForMonth" = $2 AND "appliedForMonth" IS NOT NULL`,
      [month],
    );
    const already = await sum(`"appliedForMonth" = $2`, [month]);

    const pending: { sourceForMonth: Date | string; amount: string }[] =
      await this.carryRepo.manager.query(
        `SELECT "sourceForMonth", "amount" FROM "teacher_commission_carryovers"
          WHERE "teacherId" = $1 AND "appliedForMonth" IS NULL
            AND "sourceForMonth" < $2`,
        [teacherId, month],
      );
    let wouldApply = 0;
    for (const c of pending) {
      const src = dayjs(c.sourceForMonth).format('YYYY-MM-01');
      if (await this.isSalaryPaidOut(teacherId, src)) {
        wouldApply += Number(c.amount ?? 0);
      }
    }

    const commissionAmount = this.round2(
      Math.max(0, grossCommission - carriedOut),
    );
    const carryOverCommission = this.round2(already + wouldApply);
    return {
      frozen: false as const,
      existing,
      grossPaid: this.round2(grossPaid),
      commissionPercentage: pct,
      baseSalary,
      commissionAmount,
      carryOverCommission,
      totalEarning: this.round2(
        baseSalary + commissionAmount + carryOverCommission,
      ),
      absorbedCarryover: this.round2(absorbed),
      carriedOut: this.round2(carriedOut),
      appliedFromFrozen: this.round2(wouldApply),
    };
  }

  async ensureTeacherEarningsForMonth(
    organizationId: number,
    forMonthYM: string,
  ) {
    const forMonth = this.normalizeForMonthYM(forMonthYM);

    const teachers = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.organization', 'org')
      .where('org.id = :organizationId', { organizationId })
      .andWhere('u.role = :role', { role: UserRole.TEACHER })
      .andWhere(
        '(COALESCE(u.salary, 0) > 0 OR COALESCE(u.commissionPercentage, 0) > 0)',
      )
      .getMany();

    for (const t of teachers) {
      // No force: create if missing
      // eslint-disable-next-line no-await-in-loop
      await this.calculateTeacherEarningsForMonth(
        organizationId,
        t.id,
        forMonth.slice(0, 7),
        {
          force: false,
        },
      );
    }
  }

  async listEarningsByUserIds(teacherIds: number[], forMonth: string) {
    if (!teacherIds.length) return [];
    return this.earningRepo
      .createQueryBuilder('e')
      .where('e.teacherId IN (:...teacherIds)', { teacherIds })
      .andWhere('e.forMonth = :forMonth', { forMonth })
      .getMany();
  }

  async listEarnings(organizationId: number, forMonthYM: string) {
    const forMonth = this.normalizeForMonthYM(forMonthYM);

    await this.ensureTeacherEarningsForMonth(
      organizationId,
      forMonth.slice(0, 7),
    );

    return this.earningRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.teacher', 'teacher')
      .leftJoin('teacher.organization', 'org')
      .where('org.id = :organizationId', { organizationId })
      .andWhere('e.forMonth = :forMonth', { forMonth })
      .orderBy('teacher.createdAt', 'DESC')
      .getMany();
  }
}
