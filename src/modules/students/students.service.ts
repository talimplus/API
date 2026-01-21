import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { CreateStudentDto } from '@/modules/students/dto/create-student.dto';
import { UpdateStudentDto } from '@/modules/students/dto/update-student.dto';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { CentersService } from '@/modules/centers/centers.service';
import { Group } from '@/modules/groups/entities/groups.entity';
import { UsersService } from '@/modules/users/users.service';
import { UserRole } from '@/common/enums/user-role.enums';
import { Student } from './entities/students.entity';
import { PaymentsService } from '@/modules/payments/payments.service';
import { InjectRepository } from '@nestjs/typeorm';
import { instanceToPlain } from 'class-transformer';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
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
  ) {}
  async findAll(
    organizationId: number,
    {
      centerId,
      name,
      phone,
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

  async findById(id: number) {
    const student = await this.studentRepo.findOne({
      where: { id },
      relations: ['user', 'center', 'groups', 'discountPeriods', 'subject'],
    });

    if (!student) throw new NotFoundException('O‘quvchi topilmadi');

    const result: any = instanceToPlain(student);

    // Faqat parol o‘zgartirilmagan bo‘lsa, `tempPassword` ni qaytaramiz
    result.login = student.user.login;

    // Parolni qayta generatsiya qilish (birthDate optional).
    // If birthDate missing, fallback to last 4 digits of phone to keep it deterministic.
    const phoneDigits = String(student.phone ?? '').replace(/\D/g, '');
    const phoneLast4 = phoneDigits.slice(-4) || '0000';
    const formattedBirth = student.birthDate
      ? (() => {
          const birth = new Date(student.birthDate as any);
          return `${birth.getFullYear()}${String(birth.getMonth() + 1).padStart(2, '0')}${String(birth.getDate()).padStart(2, '0')}`;
        })()
      : phoneLast4;
    result.tempPassword = `${student.firstName.toLowerCase()}${student.lastName.toLowerCase()}${formattedBirth}`;

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
    if (!student) throw new NotFoundException('O‘quvchi topilmadi');
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
    if (!exists) throw new NotFoundException('O‘quvchi topilmadi');
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

  async findByActiveStatus(): Promise<Student[]> {
    return await this.studentRepo.find({
      where: { status: StudentStatus.ACTIVE },
      relations: ['groups', 'center'],
    });
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
        ? await this.groupRepo.findBy({ id: In(safeGroupIds) })
        : [];
    const phoneDigits = String(dto.phone ?? '').replace(/\D/g, '');
    const phoneLast4 = phoneDigits.slice(-4) || '0000';
    const formattedBirth = dto.birthDate
      ? (() => {
          const birth = new Date(dto.birthDate as any);
          return `${birth.getFullYear()}${String(birth.getMonth() + 1).padStart(2, '0')}${String(birth.getDate()).padStart(2, '0')}`;
        })()
      : phoneLast4;
    const autoLogin = `${dto.firstName.toLowerCase()}.${dto.lastName.toLowerCase()}.${Date.now().toString().slice(-4)}`;
    const rawPassword = `${dto.firstName.toLowerCase()}${dto.lastName.toLowerCase()}${formattedBirth}`;
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

    if (Array.isArray(discountPeriods)) {
      await this.replaceDiscountPeriodsForStudent(
        savedStudent.id,
        discountPeriods,
      );
    }

    if (dto.referrerId) {
      const referrer = await this.studentRepo.findOneBy({ id: dto.referrerId });
      if (!referrer) {
        throw new BadRequestException('Taklif qilgan o‘quvchi topilmadi');
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
      const groups = await this.groupRepo.findBy({ id: In(dto.groupIds) });
      student.groups = groups;
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
    }

    // Return the same enriched shape as findById so frontend always has ids
    return this.findById(saved.id);
  }

  async changeStatus(
    id: number,
    status: StudentStatus,
    body?: { returnLikelihood?: StudentReturnLikelihood; comment?: string },
  ) {
    const student = await this.studentRepo.findOne({
      where: { id },
      relations: ['groups'],
    });
    if (!student) throw new NotFoundException('O‘quvchi topilmadi');

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
