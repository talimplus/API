import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { UpdateStudentDto } from '@/modules/students/dto/update-student.dto';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { CentersService } from '@/modules/centers/centers.service';
import { Group } from '@/modules/groups/entities/groups.entity';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';
import { UsersService } from '@/modules/users/users.service';
import { UserRole } from '@/common/enums/user-role.enums';
import { Student } from './entities/students.entity';
import { PaymentsService } from '@/modules/payments/payments.service';
import { InjectRepository } from '@nestjs/typeorm';
import { instanceToPlain } from 'class-transformer';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { In } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { StudentDiscountPeriod } from '@/modules/students/entities/student-discount-period.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { Referral } from '@/modules/referrals/entities/referal.entity';
import {
  Payment,
  PaymentStatus,
} from '@/modules/payments/entities/payment.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { CurrentUser } from '@/common/types/current.user';
import { StudentReturnLikelihood } from '@/common/enums/student-return-likelihood.enum';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { EnrollmentsService } from '@/modules/enrollments/enrollments.service';
import { GroupsService } from '@/modules/groups/groups.service';
import {
  TransferPreviewDto,
  TransferStudentsDto,
} from '@/modules/students/dto/transfer-students.dto';

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(StudentDiscountPeriod)
    private readonly discountPeriodRepo: Repository<StudentDiscountPeriod>,
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    private readonly centerService: CentersService,
    private readonly userService: UsersService,
    private readonly organizationsService: OrganizationsService,
    @Inject(forwardRef(() => ReferralsService))
    private readonly referralsService: ReferralsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => GroupsService))
    private readonly groupsService: GroupsService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}
  async findAll(
    organizationId: number,
    {
      centerId,
      name,
      phone,
      search,
      status,
      page = 1,
      perPage = 10,
      groupId,
      returnLikelihood,
      preferredTime,
      preferredDays,
      subjectId,
    }: {
      centerId?: number;
      name?: string;
      phone?: string;
      search?: string;
      page?: number;
      status: StudentStatus;
      perPage?: number;
      groupId?: number;
      returnLikelihood?: StudentReturnLikelihood;
      preferredTime?: StudentPreferredTime;
      preferredDays?: WeekDay[];
      subjectId?: number;
    },
    currentUser: CurrentUser,
  ) {
    const skip = (page - 1) * perPage;

    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;

    // If caller is not admin/super_admin, we must scope to their token centerId.
    // If admin/super_admin:
    // - centerId provided => scope to it
    // - centerId missing => return all centers within organization
    const resolvedCenterId = centerId
      ? await this.resolveCenterIdOrThrow(organizationId, centerId)
      : !isAdmin
        ? await this.resolveCenterIdOrThrow(
            organizationId,
            currentUser.centerId,
          )
        : undefined;

    const query = this.studentRepo
      .createQueryBuilder('student')
      // load group ids without joining (keeps pagination stable)
      .loadRelationIdAndMap('student._groupIds', 'student.groups')
      // load subject relation
      .leftJoinAndSelect('student.subject', 'subject');

    if (resolvedCenterId) {
      query.where('student.centerId = :centerId', {
        centerId: resolvedCenterId,
      });
    } else {
      // admin/super_admin + no centerId => all centers in org
      query
        .leftJoin('student.center', 'center')
        .leftJoin('center.organization', 'organization')
        .where('organization.id = :organizationId', { organizationId });
    }
    if (name) {
      query.andWhere(
        '(student.firstName ILIKE :name OR student.lastName ILIKE :name)',
        { name: `%${name}%` },
      );
    }

    if (status) {
      query.andWhere('student.status = :status', { status });
    }

    if (returnLikelihood) {
      query.andWhere('student.returnLikelihood = :returnLikelihood', {
        returnLikelihood,
      });
    }

    if (phone)
      query.andWhere('student.phone ILIKE :phone', { phone: `%${phone}%` });

    // Combined search: matches name (first/last/full) or phone numbers.
    if (search && search.trim()) {
      query.andWhere(
        `(
          student.firstName ILIKE :search
          OR student.lastName ILIKE :search
          OR (student.firstName || ' ' || student.lastName) ILIKE :search
          OR student.phone ILIKE :search
          OR student.secondPhone ILIKE :search
        )`,
        { search: `%${search.trim()}%` },
      );
    }

    if (groupId) {
      // avoid duplicating rows with many-to-many join; filter via join table subquery
      query.andWhere(
        `student.id IN (
          SELECT sg."studentsId" FROM "students_groups_groups" sg
          WHERE sg."groupsId" = :groupId
        )`,
        { groupId },
      );
    }

    if (preferredTime) {
      query.andWhere('student.preferredTime = :preferredTime', {
        preferredTime,
      });
    }

    if (preferredDays && preferredDays.length > 0) {
      // PostgreSQL array contains operator: check if student.preferredDays contains any of the provided days
      query.andWhere('student.preferredDays && ARRAY[:...preferredDays]', {
        preferredDays,
      });
    }

    if (subjectId) {
      query.andWhere('student.subjectId = :subjectId', { subjectId });
    }

    const [data, total] = await query
      .orderBy('student.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    const ids = data.map((s) => s.id);
    const referrerByReferred = new Map<number, number>();
    if (ids.length) {
      const refs = await this.referralRepo.find({
        where: { referredStudentId: In(ids) as any },
      });
      for (const r of refs as any[]) {
        if (r.referredStudentId && r.referrerStudentId) {
          referrerByReferred.set(r.referredStudentId, r.referrerStudentId);
        }
      }
    }

    // discount periods mapping
    const discountPeriodsByStudent = new Map<number, any[]>();
    if (ids.length) {
      const periods = await this.discountPeriodRepo.find({
        where: { studentId: In(ids) as any },
        order: { fromMonth: 'DESC', createdAt: 'DESC' },
      });
      for (const p of periods as any[]) {
        const list = discountPeriodsByStudent.get(p.studentId) ?? [];
        list.push({
          ...instanceToPlain(p),
          fromMonth: p.fromMonth
            ? dayjs(p.fromMonth).format('YYYY-MM-DD')
            : null,
          toMonth: p.toMonth ? dayjs(p.toMonth).format('YYYY-MM-DD') : null,
          createdAt: p.createdAt?.toISOString?.() ?? String(p.createdAt),
          percent: Number(p.percent ?? 0),
        });
        discountPeriodsByStudent.set(p.studentId, list);
      }
    }

    const enriched = data.map((s: any) => {
      const row: any = {
        ...instanceToPlain(s),
        centerId: s.centerId ?? s.center?.id ?? null,
        groupIds: Array.isArray(s._groupIds)
          ? s._groupIds.map((x: any) => Number(x))
          : [],
        referrerId: referrerByReferred.get(s.id) ?? null,
        discountPeriods: discountPeriodsByStudent.get(s.id) ?? [],
        subject: s.subject
          ? {
              id: s.subject.id,
              name: s.subject.name,
            }
          : null,
      };

      // Sensitive fields: only ADMIN/SUPER_ADMIN should see in list responses
      if (!isAdmin) {
        delete row.passportSeries;
        delete row.passportNumber;
        delete row.jshshir;
      }

      return row;
    });
    return {
      data: enriched,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async getAllByOrganizationAndCenter(
    organizationId: number,
    centerId: number,
  ): Promise<Student[]> {
    const resolvedCenterId = await this.resolveCenterIdOrThrow(
      organizationId,
      centerId,
    );
    return this.studentRepo.find({
      where: {
        center: {
          id: resolvedCenterId,
          organization: {
            id: organizationId,
          },
        },
      },
      relations: ['center'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async getAllByOrganization(organizationId: number): Promise<Student[]> {
    return this.studentRepo
      .createQueryBuilder('student')
      .leftJoinAndSelect('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .orderBy('student.createdAt', 'DESC')
      .getMany();
  }

  async getReferredStudents(organizationId: number, centerId?: number) {
    const query = this.studentRepo
      .createQueryBuilder('student')
      .andWhere('student.status IN (:...statuses)', {
        statuses: [StudentStatus.NEW, StudentStatus.ACTIVE],
      });

    if (centerId) {
      const resolvedCenterId = await this.resolveCenterIdOrThrow(
        organizationId,
        centerId,
      );
      query.andWhere('student.centerId = :centerId', {
        centerId: resolvedCenterId,
      });
    } else {
      query
        .leftJoin('student.center', 'center')
        .leftJoin('center.organization', 'organization')
        .andWhere('organization.id = :organizationId', { organizationId });
    }

    const students = await query.orderBy('student.createdAt', 'DESC').getMany();

    const plain: any[] = (instanceToPlain(students) as any[]) ?? [];
    // Referral list is used for selection; never expose sensitive passport/jshshir fields here.
    for (const r of plain) {
      delete r.passportSeries;
      delete r.passportNumber;
      delete r.jshshir;
    }
    return plain;
  }

  async findById(organizationId: number, id: number) {
    const student = await this.studentRepo.findOne({
      where: {
        id,
        center: { organization: { id: organizationId } },
      },
      relations: ['user', 'center', 'groups', 'discountPeriods', 'subject'],
    });

    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);

    const result: any = instanceToPlain(student);

    result.login = student.user.login;

    const referral = await this.referralRepo.findOne({
      where: { referredStudentId: student.id as any },
    });

    result.centerId = (student as any).centerId ?? student.center?.id ?? null;
    result.subject = student.subject
      ? {
          id: student.subject.id,
          name: student.subject.name,
        }
      : null;
    result.groupIds = (student as any).groups?.map((g: any) => g.id) ?? [];
    result.referrerId = referral?.referrerStudentId ?? null;
    result.discountPeriods = ((student as any).discountPeriods ?? []).map(
      (d: any) => ({
        ...instanceToPlain(d),
        fromMonth: d.fromMonth ? dayjs(d.fromMonth).format('YYYY-MM-DD') : null,
        toMonth: d.toMonth ? dayjs(d.toMonth).format('YYYY-MM-DD') : null,
        createdAt: d.createdAt?.toISOString?.() ?? String(d.createdAt),
        percent: Number(d.percent ?? 0),
      }),
    );

    return result;
  }

  private async findEntityByIdOrThrow(id: number) {
    const student = await this.studentRepo.findOne({
      where: { id },
      relations: ['user', 'center', 'groups', 'discountPeriods'],
    });
    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);
    return student;
  }

  private normalizeMonth(ym: string): string {
    const v = ym.trim();
    if (!/^\d{4}-\d{2}$/.test(v)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }
    return `${v}-01`;
  }

  private async assertStudentInOrganization(
    organizationId: number,
    studentId: number,
  ): Promise<void> {
    const exists = await this.studentRepo
      .createQueryBuilder('student')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'org')
      .where('student.id = :studentId', { studentId })
      .andWhere('org.id = :organizationId', { organizationId })
      .getOne();
    if (!exists) throw new NotFoundException(`O'quvchi topilmadi`);
  }

  private async resolveCenterIdOrThrow(
    organizationId: number,
    centerId?: number,
  ): Promise<number> {
    if (!centerId) throw new BadRequestException('centerId is required');

    const center = await this.centerRepo
      .createQueryBuilder('center')
      .leftJoin('center.organization', 'org')
      .where('center.id = :centerId', { centerId })
      .andWhere('org.id = :organizationId', { organizationId })
      .getOne();

    if (!center) {
      throw new BadRequestException(
        'centerId is invalid for this organization',
      );
    }

    return centerId;
  }

  private normalizeDiscountPeriodsInput(
    periods: Array<{
      percent: number;
      fromMonth: string;
      toMonth?: string | null;
      reason?: string;
    }>,
  ) {
    const normalized = periods.map((p) => {
      const from = this.normalizeMonth(p.fromMonth);
      const to = p.toMonth ? this.normalizeMonth(p.toMonth) : null;
      // Exclusive end: toMonth must be > fromMonth
      if (
        to &&
        (dayjs(to).isSame(dayjs(from)) || dayjs(to).isBefore(dayjs(from)))
      ) {
        throw new BadRequestException('toMonth must be > fromMonth');
      }
      const percent = Math.max(0, Math.min(100, Number(p.percent)));
      return {
        fromMonth: from,
        toMonth: to,
        percent,
        reason: p.reason ?? null,
      };
    });

    // Validate overlaps within the payload itself
    const sorted = [...normalized].sort((a, b) =>
      a.fromMonth.localeCompare(b.fromMonth),
    );
    let prevTo = '0000-00-01';
    for (const p of sorted) {
      const pTo = p.toMonth ?? '9999-12-01';
      if (dayjs(p.fromMonth).isBefore(dayjs(prevTo).add(0, 'month'))) {
        // This condition is conservative; overlap check below handles real overlaps
      }
      if (sorted.length > 1) {
        // overlap if previous to >= current from
      }
      prevTo = pTo;
    }

    // NOTE: overlaps are ALLOWED (stacking discounts). We only validate date correctness above.

    return normalized;
  }

  private async replaceDiscountPeriodsForStudent(
    studentId: number,
    periods: Array<{
      percent: number;
      fromMonth: string;
      toMonth?: string | null;
      reason?: string;
    }>,
  ) {
    const normalized = this.normalizeDiscountPeriodsInput(periods);

    await this.assertNoPaidPaymentsInDiscountPeriods(studentId, normalized);

    await this.discountPeriodRepo.delete({ studentId });

    if (!normalized.length) return;

    const toSave = normalized.map((p) =>
      this.discountPeriodRepo.create({
        studentId,
        percent: p.percent as any,
        fromMonth: p.fromMonth as any,
        toMonth: (p.toMonth as any) ?? null,
        reason: p.reason,
      }),
    );
    await this.discountPeriodRepo.save(toSave);
  }

  private async assertNoPaidPaymentsInDiscountPeriods(
    studentId: number,
    normalized: Array<{
      percent: number;
      fromMonth: string; // YYYY-MM-01
      toMonth: string | null; // YYYY-MM-01 (exclusive) or null=infinite
      reason?: string | null;
    }>,
  ) {
    if (!normalized.length) return;

    for (const p of normalized) {
      const qb = this.paymentRepo
        .createQueryBuilder('pay')
        .select(['pay.id as id', 'pay.forMonth as "forMonth"'])
        .where('pay.studentId = :studentId', { studentId })
        .andWhere('pay.amountPaid > 0')
        .andWhere('pay.status IN (:...st)', {
          st: [PaymentStatus.PAID, PaymentStatus.PARTIAL],
        })
        .andWhere('pay.forMonth >= :from', { from: p.fromMonth });

      if (p.toMonth) {
        qb.andWhere('pay.forMonth < :to', { to: p.toMonth });
      }

      const found = await qb.getRawOne<{ id: number; forMonth: string }>();
      if (found?.id) {
        const m = found.forMonth ? dayjs(found.forMonth).format('YYYY-MM') : '';
        throw new BadRequestException(
          `Cannot apply discount for ${m}: payment already has money received (paid/partial).`,
        );
      }
    }
  }

  async listDiscountPeriods(organizationId: number, studentId: number) {
    await this.assertStudentInOrganization(organizationId, studentId);
    const rows = await this.discountPeriodRepo.find({
      where: { studentId },
      order: { fromMonth: 'DESC', createdAt: 'DESC' },
    });
    return rows.map((r: any) => ({
      ...r,
      fromMonth: r.fromMonth ? dayjs(r.fromMonth).format('YYYY-MM-DD') : null,
      toMonth: r.toMonth ? dayjs(r.toMonth).format('YYYY-MM-DD') : null,
      createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
      percent: Number(r.percent ?? 0),
    }));
  }

  // Overlaps are allowed; we validate 0..100 cap during payment calculation.

  async createDiscountPeriod(
    organizationId: number,
    studentId: number,
    dto: {
      percent: number;
      fromMonth: string;
      toMonth?: string | null;
      reason?: string;
    },
  ) {
    await this.assertStudentInOrganization(organizationId, studentId);

    const from = this.normalizeMonth(dto.fromMonth);
    const to = dto.toMonth ? this.normalizeMonth(dto.toMonth) : null;
    if (
      to &&
      (dayjs(to).isSame(dayjs(from)) || dayjs(to).isBefore(dayjs(from)))
    ) {
      throw new BadRequestException('toMonth must be > fromMonth');
    }

    const row = this.discountPeriodRepo.create({
      studentId,
      percent: Number(dto.percent),
      fromMonth: from as any,
      toMonth: (to as any) ?? null,
      reason: dto.reason ?? null,
    });

    await this.assertNoPaidPaymentsInDiscountPeriods(studentId, [
      {
        percent: Number(dto.percent),
        fromMonth: from,
        toMonth: to,
        reason: dto.reason ?? null,
      },
    ]);

    const saved = await this.discountPeriodRepo.save(row);
    return {
      ...saved,
      fromMonth: dayjs(saved.fromMonth).format('YYYY-MM-DD'),
      toMonth: saved.toMonth ? dayjs(saved.toMonth).format('YYYY-MM-DD') : null,
      createdAt: saved.createdAt?.toISOString?.() ?? String(saved.createdAt),
      percent: Number(saved.percent ?? 0),
    };
  }

  async updateDiscountPeriod(
    organizationId: number,
    studentId: number,
    periodId: number,
    dto: {
      percent?: number;
      fromMonth?: string;
      toMonth?: string | null;
      reason?: string;
    },
  ) {
    await this.assertStudentInOrganization(organizationId, studentId);

    const existing = await this.discountPeriodRepo.findOne({
      where: { id: periodId, studentId },
    });
    if (!existing) throw new NotFoundException('Discount period not found');

    const from = dto.fromMonth
      ? this.normalizeMonth(dto.fromMonth)
      : dayjs(existing.fromMonth).format('YYYY-MM-01');
    const to =
      dto.toMonth !== undefined
        ? dto.toMonth
          ? this.normalizeMonth(dto.toMonth)
          : null
        : existing.toMonth
          ? dayjs(existing.toMonth).format('YYYY-MM-01')
          : null;

    if (
      to &&
      (dayjs(to).isSame(dayjs(from)) || dayjs(to).isBefore(dayjs(from)))
    ) {
      throw new BadRequestException('toMonth must be > fromMonth');
    }

    if (dto.percent !== undefined)
      existing.percent = Number(dto.percent) as any;
    existing.fromMonth = from as any;
    existing.toMonth = (to as any) ?? null;
    if (dto.reason !== undefined) existing.reason = dto.reason ?? null;

    await this.assertNoPaidPaymentsInDiscountPeriods(studentId, [
      {
        percent: Number(existing.percent ?? 0),
        fromMonth: from,
        toMonth: to,
        reason: existing.reason ?? null,
      },
    ]);

    const saved = await this.discountPeriodRepo.save(existing);
    return {
      ...saved,
      fromMonth: dayjs(saved.fromMonth).format('YYYY-MM-DD'),
      toMonth: saved.toMonth ? dayjs(saved.toMonth).format('YYYY-MM-DD') : null,
      createdAt: saved.createdAt?.toISOString?.() ?? String(saved.createdAt),
      percent: Number(saved.percent ?? 0),
    };
  }

  async deleteDiscountPeriod(
    organizationId: number,
    studentId: number,
    periodId: number,
  ) {
    await this.assertStudentInOrganization(organizationId, studentId);
    const existing = await this.discountPeriodRepo.findOne({
      where: { id: periodId, studentId },
    });
    if (!existing) throw new NotFoundException('Discount period not found');
    await this.discountPeriodRepo.delete({ id: periodId });
    return { success: true };
  }

  async findByActiveStatus(organizationId: number): Promise<Student[]> {
    return await this.studentRepo.find({
      where: {
        status: StudentStatus.ACTIVE,
        center: { organization: { id: organizationId } },
      },
      relations: ['groups', 'center'],
    });
  }

  /** Guruh timezone'idagi bugungi sana (YYYY-MM-DD). */
  private todayInGroupTz(group?: Group | null): string {
    return dayjs()
      .tz(group?.timezone || 'Asia/Tashkent')
      .format('YYYY-MM-DD');
  }

  /**
   * Biriktirilgan guruh(lar)ning jadval kunlaridan o'quvchining `studyDays`
   * qiymatini hisoblaydi (union, hafta tartibida). Guruh bo'lmasa yoki
   * jadval bo'lmasa `null` qaytaradi.
   */
  private async computeStudyDays(
    groupIds: number[],
  ): Promise<WeekDay[] | null> {
    if (!Array.isArray(groupIds) || groupIds.length === 0) return null;
    const groups = await this.groupRepo.find({
      where: { id: In(groupIds) },
      relations: ['schedules'],
    });
    const WEEK_ORDER: WeekDay[] = [
      WeekDay.MONDAY,
      WeekDay.TUESDAY,
      WeekDay.WEDNESDAY,
      WeekDay.THURSDAY,
      WeekDay.FRIDAY,
      WeekDay.SATURDAY,
      WeekDay.SUNDAY,
    ];
    const days = new Set<WeekDay>();
    for (const g of groups) {
      for (const s of (g as any).schedules ?? []) {
        if (s?.day) days.add(s.day as WeekDay);
      }
    }
    if (days.size === 0) return null;
    return Array.from(days).sort(
      (a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b),
    );
  }

  async create(
    dto: CreateStudentDto,
    centerId: number,
    organizationId: number,
    role: UserRole,
  ) {
    const discountPeriods = (dto as any).discountPeriods as
      | Array<{
          percent: number;
          fromMonth: string;
          toMonth?: string | null;
          reason?: string;
        }>
      | undefined;

    const effectiveCenterId =
      role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN
        ? (dto.centerId ?? centerId)
        : centerId;

    await this.resolveCenterIdOrThrow(organizationId, effectiveCenterId);
    const center = await this.centerService.findOne(effectiveCenterId);
    if (!center) throw new NotFoundException('Bunday center mavjud emas');
    const organization =
      await this.organizationsService.findById(organizationId);

    if (!organization.id) {
      throw new BadRequestException('Bunday organizatsiya mavjud emas');
    }

    // Validate and load subject if provided
    let subject: Subject | null = null;
    if (dto.subjectId) {
      subject = await this.subjectRepo.findOne({
        where: { id: dto.subjectId, center: { id: effectiveCenterId } },
      });
      if (!subject) {
        throw new BadRequestException(
          "Bunday fan topilmadi yoki bu center'ga tegishli emas",
        );
      }
    }

    const groupIds = dto.groupIds;
    const safeGroupIds = Array.isArray(groupIds) ? groupIds : [];
    const groups =
      safeGroupIds.length > 0
        ? await this.groupRepo.find({
            where: {
              id: In(safeGroupIds),
              center: { id: effectiveCenterId },
            },
          })
        : [];
    if (groups.length !== safeGroupIds.length && safeGroupIds.length > 0) {
      throw new BadRequestException(
        "Ba'zi guruhlar topilmadi yoki bu markazga tegishli emas",
      );
    }
    // Guruh(lar)ning dars kunlarini o'quvchiga yozib qo'yamiz.
    const studyDays = await this.computeStudyDays(safeGroupIds);
    const phoneDigits = String(dto.phone ?? '').replace(/\D/g, '');
    const phoneLast4 = phoneDigits.slice(-4) || '0000';
    const formattedBirth = dto.birthDate
      ? (() => {
          const birth = new Date(dto.birthDate as any);
          return `${birth.getFullYear()}${String(birth.getMonth() + 1).padStart(2, '0')}${String(birth.getDate()).padStart(2, '0')}`;
        })()
      : phoneLast4;
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    const autoLogin = `${dto.firstName.toLowerCase()}.${dto.lastName.toLowerCase()}.${Date.now().toString().slice(-4)}`;
    const rawPassword = `${dto.firstName.toLowerCase()}${formattedBirth}${randomSuffix}`;
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const user = await this.userService.create(
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        login: autoLogin,
        phone: dto.phone,
        password: hashedPassword,
        role: UserRole.STUDENT,
        centerId: effectiveCenterId,
      },
      organizationId,
      role,
    );

    if (!user) throw new BadRequestException('Nomalum xatolik');

    const student = this.studentRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      secondPhone: (dto as any).secondPhone ?? null,
      monthlyFee: dto.monthlyFee,
      discountPercent: dto.discountPercent ?? 0,
      discountReason: dto.discountReason ?? null,
      birthDate: dto.birthDate ? (dto.birthDate as any) : null,
      comment: (dto as any).comment ?? null,
      heardAboutUs: (dto as any).heardAboutUs ?? null,
      preferredTime: (dto as any).preferredTime ?? null,
      preferredDays: (dto as any).preferredDays ?? null,
      studyDays: studyDays,
      passportSeries: (dto as any).passportSeries ?? null,
      passportNumber: (dto as any).passportNumber ?? null,
      jshshir: (dto as any).jshshir ?? null,
      status: StudentStatus.NEW,
      center,
      user,
      groups: groups,
      subject: subject ?? null,
      subjectId: subject?.id ?? null,
    });

    const savedStudent = await this.studentRepo.save(student);

    // A'zolik oynasini ochamiz — to'lov proratsiyasi shu sanadan boshlanadi.
    for (const group of groups) {
      await this.enrollmentsService.open(
        savedStudent.id,
        group.id,
        this.todayInGroupTz(group),
      );
    }

    if (Array.isArray(discountPeriods)) {
      await this.replaceDiscountPeriodsForStudent(
        savedStudent.id,
        discountPeriods,
      );
    }

    if (dto.referrerId) {
      const referrer = await this.studentRepo.findOne({
        where: {
          id: dto.referrerId,
          center: { organization: { id: organizationId } },
        },
      });
      if (!referrer) {
        throw new BadRequestException(`Taklif qilgan o'quvchi topilmadi`);
      }

      await this.referralsService.create(referrer.id, savedStudent.id);
    }

    return {
      ...instanceToPlain(savedStudent),
      login: autoLogin,
      tempPassword: rawPassword,
    };
  }

  async update(organizationId: number, id: number, dto: UpdateStudentDto) {
    const discountPeriods = (dto as any).discountPeriods as
      | Array<{
          percent: number;
          fromMonth: string;
          toMonth?: string | null;
          reason?: string;
        }>
      | undefined;
    if ((dto as any).discountPeriods !== undefined) {
      delete (dto as any).discountPeriods;
    }

    // Ensure student belongs to org
    await this.assertStudentInOrganization(organizationId, id);

    const student = await this.findEntityByIdOrThrow(id);
    const user = await this.userService.findOne((student as any).user?.id);
    if (!user)
      throw new BadRequestException('Bunday foydalanuvchi mavjud emas');

    if (dto.password) {
      if (dto.password) {
        dto.password = await bcrypt.hash(dto.password, 10);
      }
    }

    const updatedUser = await this.userService.update(user.id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      login: dto.login,
      phone: dto.phone,
      centerId: dto.centerId,
      password: dto.password,
    });

    if (!updatedUser)
      throw new BadRequestException(
        "Bunday foydalanuvchi mavjud emas Yoki nomalum Xato ro'y berdi",
      );

    // group assignment update (ManyToMany)
    const shouldEnsureCurrentMonthPayments =
      Array.isArray(dto.groupIds) && dto.groupIds.length > 0;
    if (dto.groupIds) {
      const effectiveCenterId = (student as any).centerId ?? student.center?.id;
      const groups = await this.groupRepo.find({
        where: {
          id: In(dto.groupIds),
          center: { id: effectiveCenterId },
        },
      });
      if (groups.length !== dto.groupIds.length) {
        throw new BadRequestException(
          "Ba'zi guruhlar topilmadi yoki bu markazga tegishli emas",
        );
      }

      // A'zolik oynalarini avval yozamiz: chiqarilgan guruhlarga `leftAt`,
      // yangilariga `joinedAt`. To'lov qayta hisoblanganda chegaralar shu
      // yerdan o'qiladi, shuning uchun bu junction yozuvi o'chishidan (save)
      // OLDIN bajarilishi shart.
      const oldGroupIds: number[] = ((student as any).groups ?? []).map(
        (g: any) => g.id,
      );
      const removedGroupIds: number[] = oldGroupIds.filter(
        (gid: number) => !dto.groupIds!.includes(gid),
      );

      const tzGroup = groups[0] ?? (student as any).groups?.[0] ?? null;
      const today = this.todayInGroupTz(tzGroup);

      await this.enrollmentsService.syncForStudent({
        studentId: id,
        previousGroupIds: oldGroupIds,
        nextGroupIds: dto.groupIds,
        date: today,
        reason: "Guruhlar ro'yxati o'zgartirildi",
      });

      // Chiqarilgan guruhlar uchun to'lovni moslaymiz (kerak bo'lsa o'chiramiz
      // yoki ortiqcha pulni qaytariladigan qilib belgilaymiz).
      for (const gid of removedGroupIds) {
        await this.paymentsService
          .adjustPaymentsForStudentLeftGroup(id, gid, { leftAt: today })
          .catch(() => undefined);
      }

      student.groups = groups;
      // Guruh(lar) o'zgarganda dars kunlarini qayta hisoblab yozamiz
      // (guruh olib tashlansa -> null bo'ldi).
      student.studyDays = await this.computeStudyDays(dto.groupIds);

      // Guruhi tugagani uchun avtomatik `finished` bo'lgan o'quvchi yangi
      // (davom etayotgan) guruhga biriktirilsa — qayta faollashadi.
      const hasOngoingGroup = groups.some(
        (g) => g.status !== GroupStatus.FINISHED,
      );
      if (student.status === StudentStatus.FINISHED && hasOngoingGroup) {
        student.status = StudentStatus.ACTIVE;
        student.activatedAt = student.activatedAt ?? new Date();
        student.stoppedAt = null;
      }
    }

    // Referral update (stored in referrals table, not on student row)
    if ((dto as any).referrerId !== undefined) {
      const referrerId = (dto as any).referrerId as number | null;
      delete (dto as any).referrerId;

      if (referrerId === null) {
        await this.referralRepo.delete({ referredStudentId: id as any });
      } else {
        await this.assertStudentInOrganization(organizationId, referrerId);
        const existing = await this.referralRepo.findOne({
          where: { referredStudentId: id as any },
        });
        if (existing) {
          existing.referrerStudentId = referrerId as any;
          await this.referralRepo.save(existing);
        } else {
          await this.referralRepo.save(
            this.referralRepo.create({
              referredStudentId: id as any,
              referrerStudentId: referrerId as any,
              isDiscountApplied: false,
            } as any),
          );
        }
      }
    }

    // center change for student entity as well (user center updated below via userService.update)
    if ((dto as any).centerId !== undefined) {
      await this.resolveCenterIdOrThrow(
        organizationId,
        (dto as any).centerId as number,
      );
      const center = await this.centerService.findOne((dto as any).centerId);
      if (!center) throw new NotFoundException('Bunday center mavjud emas');
      (student as any).center = center as any;
      (student as any).centerId = center.id;
    }

    // Handle subjectId update
    if (dto.subjectId !== undefined) {
      const effectiveCenterId = student.centerId;
      if (dto.subjectId === null) {
        student.subject = null;
        student.subjectId = null;
      } else {
        const subject = await this.subjectRepo.findOne({
          where: { id: dto.subjectId, center: { id: effectiveCenterId } },
        });
        if (!subject) {
          throw new BadRequestException(
            "Bunday fan topilmadi yoki bu center'ga tegishli emas",
          );
        }
        student.subject = subject;
        student.subjectId = subject.id;
      }
      delete (dto as any).subjectId; // Remove from dto to avoid Object.assign issues
    }

    // Xavfsiz fieldlardan tashqarisini Object.assign qilmaslik uchun tozalash
    delete (dto as any).status;
    delete (dto as any).activatedAt;
    delete (dto as any).stoppedAt;
    delete (dto as any).groupIds;
    delete (dto as any).centerId;
    delete (dto as any).referrerId;
    delete (dto as any).userId;
    delete (dto as any).id;
    Object.assign(student, dto);
    const saved = await this.studentRepo.save(student);

    if (Array.isArray(discountPeriods)) {
      await this.replaceDiscountPeriodsForStudent(saved.id, discountPeriods);
    }

    if (
      shouldEnsureCurrentMonthPayments &&
      saved.status === StudentStatus.ACTIVE
    ) {
      // Ensure at least current month payments exist for assigned groups
      await this.paymentsService.ensurePaymentsForStudent(saved.id, {
        onlyCurrentMonth: true,
      });
      // Guruh(lar) o'zgargani uchun ochiq (to'lanmagan/qisman) to'lovlarni qayta
      // hisoblaymiz: yangi guruhga o'quvchi shu oy o'rtasida qo'shilgan bo'lsa,
      // joriy oy qo'shilgan kundan prorate qilinadi; qo'shilishdan oldingi
      // oylar uchun billable=0 bo'lib, o'sha (to'lanmagan) to'lovlar o'chiriladi.
      await this.paymentsService
        .recalculateOpenPaymentsForStudent(saved.id, { maxMonthsBack: 3 })
        .catch(() => undefined);
    }

    // Return the same enriched shape as findById so frontend always has ids
    return this.findById(organizationId, saved.id);
  }

  // ── O'quvchini boshqa guruhga ko'chirish ─────────────────────────────────

  /**
   * Ko'chirishdan OLDIN ko'rsatiladigan ma'lumot: har bir o'quvchining eski
   * guruhdagi qarzi va ortiqcha to'lagan puli. Front shu asosda ogohlantirish
   * chiqaradi (qarz ko'chirishni bloklamaydi — u eski guruhda qoladi).
   */
  async previewTransfer(
    organizationId: number,
    dto: TransferPreviewDto,
  ): Promise<
    Array<{
      studentId: number;
      firstName: string;
      lastName: string;
      debt: number;
      overpaid: number;
    }>
  > {
    // Maqsad guruh bu yerda tekshirilmaydi — u hali tanlanmagan bo'lishi mumkin.
    const fromGroup = await this.groupRepo.findOne({
      where: {
        id: dto.fromGroupId,
        center: { organization: { id: organizationId } },
      },
    });
    if (!fromGroup) throw new NotFoundException('Guruh topilmadi');

    const students = await this.studentRepo.find({
      where: {
        id: In(dto.studentIds),
        center: { organization: { id: organizationId } },
      },
    });

    const rows = await this.paymentRepo
      .createQueryBuilder('p')
      .select('p.studentId', 'studentId')
      .addSelect(
        'COALESCE(SUM(GREATEST(p.amountDue - p.amountPaid, 0)), 0)',
        'debt',
      )
      .addSelect(
        'COALESCE(SUM(GREATEST(p.amountPaid - p.amountDue, 0)), 0)',
        'overpaid',
      )
      .where('p.groupId = :groupId', { groupId: fromGroup.id })
      .andWhere('p.studentId IN (:...ids)', { ids: dto.studentIds })
      .groupBy('p.studentId')
      .getRawMany<{ studentId: number; debt: string; overpaid: string }>();

    const byStudent = new Map(rows.map((r) => [Number(r.studentId), r]));

    return students.map((s) => ({
      studentId: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      debt: Number(byStudent.get(s.id)?.debt ?? 0),
      overpaid: Number(byStudent.get(s.id)?.overpaid ?? 0),
    }));
  }

  private async resolveTransferGroups(
    organizationId: number,
    dto: TransferStudentsDto,
  ): Promise<{ fromGroup: Group; toGroup: Group }> {
    if (dto.fromGroupId === dto.toGroupId) {
      throw new BadRequestException(
        "Manba va maqsad guruh bir xil bo'lishi mumkin emas",
      );
    }

    const groups = await this.groupRepo.find({
      where: {
        id: In([dto.fromGroupId, dto.toGroupId]),
        center: { organization: { id: organizationId } },
      },
      relations: ['center', 'schedules'],
    });

    const fromGroup = groups.find((g) => g.id === dto.fromGroupId);
    const toGroup = groups.find((g) => g.id === dto.toGroupId);
    if (!fromGroup || !toGroup) {
      throw new NotFoundException('Guruh topilmadi');
    }
    if (fromGroup.center?.id !== toGroup.center?.id) {
      throw new BadRequestException(
        "O'quvchini boshqa filial guruhiga ko'chirib bo'lmaydi",
      );
    }
    if (toGroup.status === GroupStatus.FINISHED) {
      throw new BadRequestException("Tugagan guruhga ko'chirib bo'lmaydi");
    }

    return { fromGroup, toGroup };
  }

  /**
   * O'quvchilarni bir guruhdan boshqasiga ko'chiradi.
   *
   * Pul tomoni (`payments.settlePaymentsForTransfer`):
   *  - eski guruh ko'chirish sanasigacha o'tgan darslar bo'yicha prorate;
   *  - yangi guruh ko'chirish sanasidan qolgan darslar bo'yicha prorate;
   *  - eski guruhga ortiqcha to'langan pul yangi guruh to'loviga chek bilan
   *    o'tkaziladi (naqd qaytarilmaydi);
   *  - eski guruhdagi qarz o'sha guruh nomi bilan qolaveradi.
   *
   * O'qituvchi komissiyasi har doim to'lov qatorining guruhiga qarab
   * hisoblanadi, shuning uchun eski o'qituvchi o'tgan darslar uchun o'z
   * foizini saqlaydi, yangi o'qituvchi esa faqat o'z qismidan oladi.
   */
  async transferStudents(
    organizationId: number,
    dto: TransferStudentsDto,
    currentUser: CurrentUser,
  ) {
    const { fromGroup, toGroup } = await this.resolveTransferGroups(
      organizationId,
      dto,
    );

    const transferDate = dto.transferDate ?? this.todayInGroupTz(toGroup);

    const students = await this.studentRepo.find({
      where: {
        id: In(dto.studentIds),
        center: { organization: { id: organizationId } },
      },
      relations: ['groups'],
    });
    if (students.length !== dto.studentIds.length) {
      throw new BadRequestException(
        "Ba'zi o'quvchilar topilmadi yoki bu tashkilotga tegishli emas",
      );
    }

    const notInSource = students.filter(
      (s) => !(s.groups ?? []).some((g) => g.id === fromGroup.id),
    );
    if (notInSource.length) {
      const names = notInSource
        .map((s) => `${s.firstName} ${s.lastName}`)
        .join(', ');
      throw new BadRequestException(
        `Bu o'quvchilar manba guruhda emas: ${names}`,
      );
    }

    const reason =
      dto.reason?.trim() || `"${fromGroup.name}" dan "${toGroup.name}" ga`;

    const results: Array<{
      studentId: number;
      firstName: string;
      lastName: string;
      carriedOverAmount: number;
      refundedAmount: number;
      remainingDebtInSourceGroup: number;
    }> = [];

    for (const student of students) {
      const alreadyInTarget = (student.groups ?? []).some(
        (g) => g.id === toGroup.id,
      );

      // 1) A'zolik oynalari — to'lov chegaralari shu yerdan o'qiladi,
      //    shuning uchun junction o'zgarishidan OLDIN yoziladi.
      await this.enrollmentsService.close(
        student.id,
        fromGroup.id,
        transferDate,
        { reason, transferredToGroupId: toGroup.id },
      );
      if (!alreadyInTarget) {
        await this.enrollmentsService.open(
          student.id,
          toGroup.id,
          transferDate,
          { transferredFromGroupId: fromGroup.id },
        );
      }

      // 2) Joriy a'zolik (many-to-many) — eski guruhdan chiqarib, yangisiga.
      await this.studentRepo
        .createQueryBuilder()
        .relation(Student, 'groups')
        .of(student.id)
        .addAndRemove(alreadyInTarget ? [] : [toGroup.id], [fromGroup.id]);

      // 3) Status va dars kunlari.
      //
      // MUHIM: bu yerda `studentRepo.save(student)` ishlatilmaydi. Entity
      // `groups` bilan yuklangan va uning xotiradagi nusxasi hali ESKI
      // guruhni saqlab turibdi — save() many-to-many farqini hisoblab,
      // yuqoridagi addAndRemove'ni bekor qilib yuborardi. Shuning uchun
      // faqat ustunlarni yangilaymiz.
      const nextGroupIds = Array.from(
        new Set([
          ...(student.groups ?? [])
            .map((g) => g.id)
            .filter((gid) => gid !== fromGroup.id),
          toGroup.id,
        ]),
      );

      const patch: Partial<Student> = {
        studyDays: await this.computeStudyDays(nextGroupIds),
      };
      if (
        student.status === StudentStatus.FINISHED &&
        toGroup.status !== GroupStatus.FINISHED
      ) {
        // Kurs tugab keyingi bosqichga o'tgan o'quvchi qayta faollashadi.
        patch.status = StudentStatus.ACTIVE;
        patch.activatedAt = student.activatedAt ?? new Date();
        patch.stoppedAt = null;
      }
      await this.studentRepo.update(student.id, patch as any);
      Object.assign(student, patch);

      // 4) Pul: eski guruhni yopish, yangisini ochish, ortiqchasini ko'chirish.
      const settlement = await this.paymentsService.settlePaymentsForTransfer({
        studentId: student.id,
        fromGroupId: fromGroup.id,
        toGroupId: toGroup.id,
        transferDate,
        performedById: currentUser?.userId ?? null,
        comment: `Ko'chirildi: ${reason}`,
      });

      const debtRow = await this.paymentRepo
        .createQueryBuilder('p')
        .select(
          'COALESCE(SUM(GREATEST(p.amountDue - p.amountPaid, 0)), 0)',
          'debt',
        )
        .where('p.groupId = :groupId', { groupId: fromGroup.id })
        .andWhere('p.studentId = :studentId', { studentId: student.id })
        .getRawOne<{ debt: string }>();

      results.push({
        studentId: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        carriedOverAmount: settlement.carriedOverAmount,
        refundedAmount: settlement.refundedAmount,
        remainingDebtInSourceGroup: Number(debtRow?.debt ?? 0),
      });
    }

    // 5) Kerak bo'lsa eski guruhni yopamiz (odam kam qolgani uchun yopilgan
    //    guruh holati).
    let sourceGroupClosed = false;
    if (dto.closeSourceGroup) {
      // `changeStatus` tugash sanasi majburiy bo'lishini talab qiladi (aks holda
      // darslar va to'lovlar cheksiz hisoblanadi). Guruh muddatsiz bo'lsa yoki
      // tugash sanasi ko'chirish kunidan keyin bo'lsa — sanani ko'chirish kuniga
      // tortamiz: oxirgi o'quvchi shu kuni ketdi, undan keyin dars yo'q.
      const currentEndDate = fromGroup.endDate
        ? dayjs(fromGroup.endDate).format('YYYY-MM-DD')
        : null;
      if (!currentEndDate || currentEndDate > transferDate) {
        await this.groupRepo.update(fromGroup.id, {
          endDate: transferDate as any,
        });
      }

      await this.groupsService.changeStatus(
        organizationId,
        fromGroup.id,
        GroupStatus.FINISHED,
        fromGroup.center?.id,
      );
      sourceGroupClosed = true;
    }

    return {
      fromGroupId: fromGroup.id,
      toGroupId: toGroup.id,
      transferDate,
      sourceGroupClosed,
      transferred: results.length,
      results,
    };
  }

  private static readonly ALLOWED_STATUS_TRANSITIONS: Record<
    StudentStatus,
    StudentStatus[]
  > = {
    [StudentStatus.NEW]: [StudentStatus.ACTIVE, StudentStatus.IGNORED],
    [StudentStatus.ACTIVE]: [StudentStatus.STOPPED, StudentStatus.FINISHED],
    [StudentStatus.STOPPED]: [StudentStatus.ACTIVE, StudentStatus.FINISHED],
    [StudentStatus.IGNORED]: [StudentStatus.NEW, StudentStatus.ACTIVE],
    // Guruhi qayta ochilsa yoki yangi guruhga yozilsa — qaytarish mumkin.
    [StudentStatus.FINISHED]: [StudentStatus.ACTIVE],
  };

  async changeStatus(
    organizationId: number,
    id: number,
    status: StudentStatus,
    body?: { returnLikelihood?: StudentReturnLikelihood; comment?: string },
  ) {
    const student = await this.studentRepo.findOne({
      where: {
        id,
        center: { organization: { id: organizationId } },
      },
      relations: ['groups'],
    });
    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);

    const allowed =
      StudentsService.ALLOWED_STATUS_TRANSITIONS[student.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `${student.status} → ${status} o'tish mumkin emas`,
      );
    }

    if (body?.comment !== undefined) {
      const incoming = String(body.comment ?? '').trim();
      if (incoming) {
        // Append to existing comment to avoid losing history
        (student as any).comment = (student as any).comment
          ? `${(student as any).comment}\n${incoming}`
          : incoming;
      }
    }

    if (status === StudentStatus.STOPPED || status === StudentStatus.IGNORED) {
      const rl = body?.returnLikelihood;
      if (!rl) {
        throw new ValidationException({
          returnLikelihood: 'returnLikelihood is required for stopped/ignored',
        });
      }
      if (!Object.values(StudentReturnLikelihood).includes(rl)) {
        throw new ValidationException({
          returnLikelihood: 'returnLikelihood is invalid',
        });
      }
      (student as any).returnLikelihood = rl as any;
    }

    if (
      status === StudentStatus.ACTIVE &&
      student.status === StudentStatus.NEW &&
      (!Array.isArray((student as any).groups) ||
        (student as any).groups.length === 0)
    ) {
      throw new BadRequestException(
        'Guruh tanlanishi kerak (student groupga biriktirilmagan)',
      );
    }

    // When student becomes ACTIVE, they start paying from that moment.
    // Always set activatedAt on transition into ACTIVE (so proration is based on the real activation moment).
    if (
      status === StudentStatus.ACTIVE &&
      student.status !== StudentStatus.ACTIVE
    ) {
      student.activatedAt = new Date();
      student.stoppedAt = null;
    }

    // When student becomes STOPPED, remember stop time (used for refunds/proration end boundary).
    if (
      status === StudentStatus.STOPPED &&
      student.status !== StudentStatus.STOPPED
    ) {
      student.stoppedAt = new Date();
    }

    student.status = status;
    const saved = await this.studentRepo.save(student);

    if (status === StudentStatus.ACTIVE) {
      // Create/ensure payments for current month for all groups the student belongs to.
      // (Payment creation is group-based; if student has no groups, nothing is created.)
      await this.paymentsService.ensurePaymentsForStudent(saved.id, {
        onlyCurrentMonth: true,
      });
    }

    if (status === StudentStatus.STOPPED) {
      // Adjust current month payments and compute refunds for unstudied lessons.
      await this.paymentsService.adjustPaymentsForStudentStopped(saved.id);
    }

    return saved;
  }
}
