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
import { PaymentReceiptStatus } from '@/modules/payments/entities/payment-receipt.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { Referral } from '@/modules/referrals/entities/referal.entity';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { CurrentUser } from '@/common/types/current.user';
import { StudentReturnLikelihood } from '@/common/enums/student-return-likelihood.enum';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { StudentPreferredTime } from '@/common/enums/student-preferred-time.enum';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { EnrollmentsService } from '@/modules/enrollments/enrollments.service';
import { GroupsService } from '@/modules/groups/groups.service';
import { Attendance } from '@/modules/attendance/entities/attendance.entity';
import { StudentEventsService } from '@/modules/student-history/student-events.service';
import { StudentEventType } from '@/modules/student-history/student-timeline.enums';
import { StudentBaseDiscountService } from '@/modules/students/student-base-discount.service';
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
    private readonly baseDiscountService: StudentBaseDiscountService,
    private readonly studentEvents: StudentEventsService,
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
    // Telefon bazada har xil yozilgan (97-752-20-14, +998977522014, ...),
    // shuning uchun raqamlar faqat raqamlar bilan solishtiriladi.
    if (search && search.trim()) {
      const searchDigits = search.replace(/\D/g, '');
      query.andWhere(
        `(
          student.firstName ILIKE :search
          OR student.lastName ILIKE :search
          OR (student.firstName || ' ' || student.lastName) ILIKE :search
          OR (student.lastName || ' ' || student.firstName) ILIKE :search
          OR student.phone ILIKE :search
          OR student.secondPhone ILIKE :search
          ${
            searchDigits.length >= 3
              ? `OR regexp_replace(COALESCE(student.phone, ''), '\\D', '', 'g') LIKE :searchDigits
          OR regexp_replace(COALESCE(student.secondPhone, ''), '\\D', '', 'g') LIKE :searchDigits`
              : ''
          }
        )`,
        { search: `%${search.trim()}%`, searchDigits: `%${searchDigits}%` },
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
      query.andWhere(
        `(student.subjectId = :subjectId OR EXISTS (
          SELECT 1 FROM student_subjects ss
          WHERE ss."studentId" = student.id AND ss."subjectId" = :subjectId
        ))`,
        { subjectId },
      );
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
        list.push(this.toDiscountPeriodView(p));
        discountPeriodsByStudent.set(p.studentId, list);
      }
    }

    const subjectsByStudent = await this.loadSubjectsByStudent(
      data as Student[],
    );

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
        subjects: subjectsByStudent.get(s.id) ?? [],
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
      relations: [
        'user',
        'center',
        'groups',
        'discountPeriods',
        'subject',
        'subjects',
      ],
    });

    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);

    const result: any = instanceToPlain(student);

    // Import qilingan o‘quvchida kabinet akkaunti bo‘lmasligi mumkin
    result.login = student.user?.login ?? null;

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
    result.subjects = this.orderSubjects(
      student.subjects ?? [],
      student.subjectId,
    );
    result.groupIds = (student as any).groups?.map((g: any) => g.id) ?? [];
    result.referrerId = referral?.referrerStudentId ?? null;
    result.discountPeriods = ((student as any).discountPeriods ?? []).map(
      (d: any) => this.toDiscountPeriodView(d),
    );
    // Tekin davr sanalari (guruhga qo'shilmagan bo'lsa hali noma'lum — null).
    result.freeWindow = await this.paymentsService.resolveFreeWindow(student, {
      fresh: true,
    });

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

  /**
   * Fanlar ro'yxati: hammasi shu filialniki bo'lishi shart, takrorlar olib
   * tashlanadi, berilgan tartib saqlanadi (birinchisi `subjectId` ga yoziladi).
   */
  private async findSubjectsInCenter(
    subjectIds: number[],
    centerId: number | null | undefined,
  ): Promise<Subject[]> {
    const unique = [...new Set(subjectIds.map(Number).filter(Boolean))];
    if (!unique.length) return [];
    const found = await this.subjectRepo.find({
      where: { id: In(unique), center: { id: centerId as number } },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException(
        "Bunday fan topilmadi yoki bu center'ga tegishli emas",
      );
    }
    const byId = new Map(found.map((x) => [x.id, x]));
    return unique.map((id) => byId.get(id) as Subject);
  }

  /** Javob uchun: asosiy fan (`subjectId`) birinchi, qolganlari id bo'yicha. */
  private orderSubjects(
    subjects: Subject[],
    primaryId: number | null | undefined,
  ): Array<{ id: number; name: string }> {
    return [...subjects]
      .sort(
        (a, b) =>
          Number(b.id === primaryId) - Number(a.id === primaryId) ||
          a.id - b.id,
      )
      .map((x) => ({ id: x.id, name: x.name }));
  }

  /** Ro'yxat sahifasi uchun fanlar — bitta so'rovda (pagination buzilmaydi). */
  private async loadSubjectsByStudent(
    students: Student[],
  ): Promise<Map<number, Array<{ id: number; name: string }>>> {
    const result = new Map<number, Array<{ id: number; name: string }>>();
    if (!students.length) return result;
    const rows = await this.studentRepo
      .createQueryBuilder('student')
      .leftJoinAndSelect('student.subjects', 'subjects')
      .select([
        'student.id',
        'student.subjectId',
        'subjects.id',
        'subjects.name',
      ])
      .where('student.id IN (:...ids)', { ids: students.map((x) => x.id) })
      .getMany();
    for (const row of rows) {
      result.set(row.id, this.orderSubjects(row.subjects ?? [], row.subjectId));
    }
    return result;
  }

  /** Fan shu filialga tegishli bo'lishi shart (boshqa filial fanini biriktirib bo'lmaydi). */
  private async findSubjectInCenter(
    subjectId: number,
    centerId: number | null | undefined,
  ): Promise<Subject> {
    const subject = await this.subjectRepo.findOne({
      where: { id: subjectId, center: { id: centerId as number } },
    });
    if (!subject) {
      throw new BadRequestException(
        "Bunday fan topilmadi yoki bu center'ga tegishli emas",
      );
    }
    return subject;
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

  /** Chegirma davrining API ko'rinishi (ro'yxat, kartochka, CRUD javoblari). */
  private toDiscountPeriodView(d: any) {
    return {
      ...instanceToPlain(d),
      fromMonth: d.fromMonth ? dayjs(d.fromMonth).format('YYYY-MM-DD') : null,
      toMonth: d.toMonth ? dayjs(d.toMonth).format('YYYY-MM-DD') : null,
      createdAt: d.createdAt?.toISOString?.() ?? String(d.createdAt),
      percent: Number(d.percent ?? 0),
      amount: Number(d.amount ?? 0),
      groupId: d.groupId ?? null,
    };
  }

  /**
   * Bitta davr: foiz (0..100) YOKI summa (so'm/oy) — ikkalasidan aynan bittasi.
   * `groupId` — chegirma qaysi fanga (bo'sh — barcha guruhlarga).
   */
  private normalizeDiscountValue(p: {
    percent?: number | null;
    amount?: number | null;
  }): { percent: number; amount: number } {
    const percent = Math.max(0, Math.min(100, Number(p.percent ?? 0)));
    const amount = Math.max(0, Number(p.amount ?? 0));
    if (percent > 0 && amount > 0) {
      throw new ValidationException({
        amount:
          'Chegirma foizda yoki summada bo‘lishi kerak, ikkalasi birga emas',
      });
    }
    if (!percent && !amount) {
      throw new ValidationException({
        percent: 'Chegirma foizi yoki summasini kiriting',
      });
    }
    return { percent, amount };
  }

  /** Chegirma bog'lanadigan guruh o'quvchining tashkilotiga tegishli bo'lishi shart (IDOR). */
  private async assertDiscountGroupsInStudentOrg(
    studentId: number,
    groupIds: Array<number | null | undefined>,
  ) {
    const ids = Array.from(new Set(groupIds.filter((g): g is number => !!g)));
    if (!ids.length) return;
    const rows = await this.studentRepo.query(
      `SELECT g.id FROM groups g
         JOIN centers gc ON gc.id = g."centerId"
         JOIN students s ON s.id = $1
         JOIN centers sc ON sc.id = s."centerId"
        WHERE g.id = ANY($2) AND gc."organizationId" = sc."organizationId"`,
      [studentId, ids],
    );
    if (rows.length !== ids.length) {
      throw new ValidationException({ groupId: 'Guruh topilmadi' });
    }
  }

  private normalizeDiscountPeriodsInput(
    periods: Array<{
      percent?: number;
      amount?: number;
      groupId?: number | null;
      fromMonth: string;
      toMonth?: string | null;
      reason?: string;
    }>,
  ) {
    // NOTE: overlaps are ALLOWED (stacking discounts). Only dates and values are validated.
    return periods.map((p) => {
      const from = this.normalizeMonth(p.fromMonth);
      const to = p.toMonth ? this.normalizeMonth(p.toMonth) : null;
      // Exclusive end: toMonth must be > fromMonth
      if (
        to &&
        (dayjs(to).isSame(dayjs(from)) || dayjs(to).isBefore(dayjs(from)))
      ) {
        throw new BadRequestException('toMonth must be > fromMonth');
      }
      return {
        fromMonth: from,
        toMonth: to,
        ...this.normalizeDiscountValue(p),
        groupId: p.groupId ?? null,
        reason: p.reason ?? null,
      };
    });
  }

  private async replaceDiscountPeriodsForStudent(
    studentId: number,
    periods: Array<{
      percent?: number;
      amount?: number;
      groupId?: number | null;
      fromMonth: string;
      toMonth?: string | null;
      reason?: string;
    }>,
  ) {
    const normalized = this.normalizeDiscountPeriodsInput(periods);
    await this.assertDiscountGroupsInStudentOrg(
      studentId,
      normalized.map((p) => p.groupId),
    );

    // Forma har saqlashda BARCHA davrlarni qayta yuboradi. O'zgarmagan davr
    // (masalan to'langan oyga tegadigan eski chegirma) tekshirilmaydi — aks holda
    // o'quvchining ismini tuzatish ham "payment already has money" bilan yiqilardi.
    const periodKey = (p: {
      fromMonth: string;
      toMonth: string | null;
      percent: number;
      amount: number;
      groupId: number | null;
    }) =>
      [p.fromMonth, p.toMonth ?? '', p.percent, p.amount, p.groupId ?? ''].join(
        '|',
      );
    const existing = await this.discountPeriodRepo.find({
      where: { studentId },
    });
    const unchanged = new Set(
      existing.map((e) =>
        periodKey({
          fromMonth: dayjs(e.fromMonth).format('YYYY-MM-01'),
          toMonth: e.toMonth ? dayjs(e.toMonth).format('YYYY-MM-01') : null,
          percent: Number(e.percent ?? 0),
          amount: Number(e.amount ?? 0),
          groupId: e.groupId ?? null,
        }),
      ),
    );
    await this.assertNoPaidPaymentsInDiscountPeriods(
      studentId,
      normalized.filter((p) => !unchanged.has(periodKey(p))),
    );

    await this.discountPeriodRepo.delete({ studentId });

    if (!normalized.length) return;

    const toSave = normalized.map((p) =>
      this.discountPeriodRepo.create({
        studentId,
        percent: p.percent as any,
        amount: p.amount as any,
        groupId: p.groupId,
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
      fromMonth: string; // YYYY-MM-01
      toMonth: string | null; // YYYY-MM-01 (exclusive) or null=infinite
      groupId?: number | null;
    }>,
  ) {
    if (!normalized.length) return;

    for (const p of normalized) {
      const qb = this.paymentRepo
        .createQueryBuilder('pay')
        .select(['pay.id as id', 'pay.forMonth as "forMonth"'])
        .where('pay.studentId = :studentId', { studentId })
        // Pul olingan oy: tasdiqlangan pul yoki tasdiq kutayotgan chek bor.
        .andWhere(
          `(pay.amountPaid > 0 OR EXISTS (
             SELECT 1 FROM payment_receipts r
              WHERE r."paymentId" = pay.id AND r.status = :pendingStatus))`,
          { pendingStatus: PaymentReceiptStatus.PENDING },
        )
        .andWhere('pay.forMonth >= :from', { from: p.fromMonth });

      if (p.toMonth) {
        qb.andWhere('pay.forMonth < :to', { to: p.toMonth });
      }
      // Bitta fanga bog'langan chegirma faqat o'sha guruh to'lovlariga tegadi
      if (p.groupId) {
        qb.andWhere('pay.groupId = :groupId', { groupId: p.groupId });
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

  /**
   * Tekin oylar sonini o'zgartirish: eski va yangi oraliqlarning birlashmasiga
   * tushadigan oylarda pul (yoki tasdiq kutayotgan chek) bo'lmasligi shart.
   */
  private async assertFreeMonthsChangeAllowed(
    student: Student,
    nextMonths: number,
  ) {
    const windows = (
      await Promise.all([
        this.paymentsService.resolveFreeWindow(student, { fresh: true }),
        this.paymentsService.resolveFreeWindow(
          { ...student, freeMonths: nextMonths } as Student,
          { fresh: true },
        ),
      ])
    ).filter((w): w is NonNullable<typeof w> => Boolean(w));
    if (!windows.length) return;

    const from = dayjs(windows[0].from).format('YYYY-MM-01');
    const until = windows.map((w) => w.untilExclusive).sort()[
      windows.length - 1
    ];
    const lastMonth = dayjs(until)
      .subtract(1, 'day')
      .startOf('month')
      .format('YYYY-MM-01');

    const found = await this.paymentRepo
      .createQueryBuilder('pay')
      .select(['pay.id as id', 'pay.forMonth as "forMonth"'])
      .where('pay.studentId = :studentId', { studentId: student.id })
      .andWhere(
        `(pay.amountPaid > 0 OR EXISTS (
           SELECT 1 FROM payment_receipts r
            WHERE r."paymentId" = pay.id AND r.status = :pendingStatus))`,
        { pendingStatus: PaymentReceiptStatus.PENDING },
      )
      .andWhere('pay.forMonth >= :from', { from })
      .andWhere('pay.forMonth <= :lastMonth', { lastMonth })
      .getRawOne<{ id: number; forMonth: string }>();
    if (found?.id) {
      const m = dayjs(found.forMonth).format('YYYY-MM');
      throw new ValidationException({
        freeMonths: `Tekin oylarni o'zgartirib bo'lmaydi: ${m} uchun pul olingan`,
      });
    }
  }

  async listDiscountPeriods(organizationId: number, studentId: number) {
    await this.assertStudentInOrganization(organizationId, studentId);
    const rows = await this.discountPeriodRepo.find({
      where: { studentId },
      order: { fromMonth: 'DESC', createdAt: 'DESC' },
    });
    return rows.map((r) => this.toDiscountPeriodView(r));
  }

  // Overlaps are allowed; we validate 0..100 cap during payment calculation.

  async createDiscountPeriod(
    organizationId: number,
    studentId: number,
    dto: {
      percent?: number;
      amount?: number;
      groupId?: number | null;
      fromMonth: string;
      toMonth?: string | null;
      reason?: string;
    },
  ) {
    await this.assertStudentInOrganization(organizationId, studentId);
    const [normalized] = this.normalizeDiscountPeriodsInput([dto]);
    await this.assertDiscountGroupsInStudentOrg(studentId, [
      normalized.groupId,
    ]);
    await this.assertNoPaidPaymentsInDiscountPeriods(studentId, [normalized]);

    const saved = await this.discountPeriodRepo.save(
      this.discountPeriodRepo.create({
        studentId,
        percent: normalized.percent,
        amount: normalized.amount,
        groupId: normalized.groupId,
        fromMonth: normalized.fromMonth as any,
        toMonth: (normalized.toMonth as any) ?? null,
        reason: normalized.reason,
      }),
    );
    await this.recalcAfterDiscountChange(studentId);
    return this.toDiscountPeriodView(saved);
  }

  /**
   * Chegirma davri o'zgargach ochiq to'lovlarni darhol yangilaymiz — aks holda
   * qabulxona eski (to'liq) summani olib qo'yardi.
   */
  private async recalcAfterDiscountChange(studentId: number) {
    await this.paymentsService
      .recalculateOpenPaymentsForStudent(studentId)
      .catch(() => undefined);
  }

  /** Mavjud davrning oralig'i (tekshiruv uchun). */
  private existingDiscountRange(existing: StudentDiscountPeriod) {
    return {
      fromMonth: dayjs(existing.fromMonth).format('YYYY-MM-01'),
      toMonth: existing.toMonth
        ? dayjs(existing.toMonth).format('YYYY-MM-01')
        : null,
      groupId: existing.groupId ?? null,
    };
  }

  async updateDiscountPeriod(
    organizationId: number,
    studentId: number,
    periodId: number,
    dto: {
      percent?: number;
      amount?: number;
      groupId?: number | null;
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

    // Qiymat turi almashtirilishi mumkin: faqat percent kelsa — summa nolga, va aksincha
    const valueChanged = dto.percent !== undefined || dto.amount !== undefined;
    const [normalized] = this.normalizeDiscountPeriodsInput([
      {
        percent: valueChanged ? dto.percent : Number(existing.percent ?? 0),
        amount: valueChanged ? dto.amount : Number(existing.amount ?? 0),
        groupId: dto.groupId !== undefined ? dto.groupId : existing.groupId,
        fromMonth: dto.fromMonth ?? dayjs(existing.fromMonth).format('YYYY-MM'),
        toMonth:
          dto.toMonth !== undefined
            ? dto.toMonth
            : existing.toMonth
              ? dayjs(existing.toMonth).format('YYYY-MM')
              : null,
        reason:
          dto.reason !== undefined
            ? dto.reason
            : (existing.reason ?? undefined),
      },
    ]);
    await this.assertDiscountGroupsInStudentOrg(studentId, [
      normalized.groupId,
    ]);
    // Yangi oraliq ham, eski oraliq ham tekshiriladi: pul olingan oydan
    // chegirmani olib tashlash ham qarzni o'zgartiradi.
    await this.assertNoPaidPaymentsInDiscountPeriods(studentId, [
      normalized,
      this.existingDiscountRange(existing),
    ]);

    existing.percent = normalized.percent as any;
    existing.amount = normalized.amount as any;
    existing.groupId = normalized.groupId;
    existing.fromMonth = normalized.fromMonth as any;
    existing.toMonth = (normalized.toMonth as any) ?? null;
    existing.reason = normalized.reason;

    const saved = await this.discountPeriodRepo.save(existing);
    await this.recalcAfterDiscountChange(studentId);
    return this.toDiscountPeriodView(saved);
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
    await this.assertNoPaidPaymentsInDiscountPeriods(studentId, [
      this.existingDiscountRange(existing),
    ]);
    await this.discountPeriodRepo.delete({ id: periodId });
    await this.recalcAfterDiscountChange(studentId);
    return { success: true };
  }

  /**
   * Faqat qabuldagi (NEW) o'quvchini o'chirish. `students` ga bog'langan
   * barcha FK'lar CASCADE — shu sabab to'lov yoki davomat tarixi bo'lsa,
   * status NEW bo'lsa ham o'chirmaymiz.
   */
  async remove(organizationId: number, id: number) {
    const student = await this.studentRepo.findOne({
      where: { id, center: { organization: { id: organizationId } } },
    });
    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);

    if (student.status !== StudentStatus.NEW) {
      throw new BadRequestException(
        "Faqat qabuldagi (NEW) o'quvchini o'chirish mumkin. " +
          "Boshqa holatda statusni o'zgartiring.",
      );
    }

    const [usage] = await this.studentRepo.manager.query(
      `SELECT
         EXISTS (SELECT 1 FROM "payments" WHERE "studentId" = $1)
      OR EXISTS (SELECT 1 FROM "attendance" WHERE "studentId" = $1)
         AS "hasHistory"`,
      [student.id],
    );
    if (usage?.hasHistory) {
      throw new BadRequestException(
        "O'quvchining to'lov yoki davomat tarixi bor — uni o'chirib bo'lmaydi.",
      );
    }

    await this.studentRepo.remove(student);
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

    // Fanlar: `subjectIds` (cheklanmagan) ustun, eski front faqat `subjectId` yuboradi.
    const subjects = await this.findSubjectsInCenter(
      dto.subjectIds ?? (dto.subjectId ? [dto.subjectId] : []),
      effectiveCenterId,
    );
    const subject = subjects[0] ?? null;

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
      discountAmount: dto.discountAmount ?? 0,
      discountReason: dto.discountReason ?? null,
      freeMonths: dto.freeMonths ?? 0,
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
      subject,
      subjectId: subject?.id ?? null,
      subjects,
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

  async update(
    organizationId: number,
    id: number,
    dto: UpdateStudentDto,
    actorId?: number | null,
  ) {
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
    const profileBefore = await this.snapshotProfile(student, dto);
    const passwordSent = !!dto.password && !!(student as any).user;
    // Login o'quvchida emas, bog'langan akkauntda — yuborilgan qiymat bilan.
    const loginChanged =
      dto.login !== undefined &&
      !!(student as any).user &&
      String((student as any).user.login ?? '') !== String(dto.login ?? '');

    // O'quvchining kabinet akkaunti (users, role=student) bo'lmasligi mumkin —
    // masalan tashqi manbadan import qilinganlar. Unda faqat o'quvchi yoziladi.
    // (Ilgari findOne(undefined) jadvaldagi birinchi foydalanuvchini qaytarib,
    // BEGONA akkauntni shu o'quvchi nomi/telefoniga qayta yozib yuborardi.)
    const linkedUserId: number | undefined = (student as any).user?.id;
    if (linkedUserId) {
      if (dto.password) {
        dto.password = await bcrypt.hash(dto.password, 10);
      }

      const updatedUser = await this.userService.update(linkedUserId, {
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
    }

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

    // Fanlar. `subjectIds` — to'liq ro'yxat (almashtiriladi). Faqat `subjectId`
    // kelsa (eski front) — asosiy fan almashadi, qolgan fanlar saqlanadi.
    if (dto.subjectIds !== undefined || dto.subjectId !== undefined) {
      let ids: number[];
      if (dto.subjectIds !== undefined) {
        ids = dto.subjectIds ?? [];
      } else {
        const current = await this.studentRepo
          .createQueryBuilder()
          .relation(Student, 'subjects')
          .of(student.id)
          .loadMany<Subject>();
        const rest = current
          .map((x) => x.id)
          .filter((x) => x !== student.subjectId);
        ids = dto.subjectId ? [dto.subjectId, ...rest] : rest;
      }
      const subjects = await this.findSubjectsInCenter(ids, student.centerId);
      student.subjects = subjects;
      student.subject = subjects[0] ?? null;
      student.subjectId = subjects[0]?.id ?? null;
      delete (dto as any).subjectId; // Object.assign relation'ni buzmasligi uchun
      delete (dto as any).subjectIds;
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
    // Tekin oylar soni o'zgarsa: eski yoki yangi oraliqqa pul tushgan oy
    // bo'lsa — rad etiladi (to'langan oy qayta narxlanmaydi).
    const freeMonthsChanged =
      dto.freeMonths !== undefined &&
      Number(dto.freeMonths) !== Number(student.freeMonths ?? 0);
    if (freeMonthsChanged) {
      await this.assertFreeMonthsChangeAllowed(student, Number(dto.freeMonths));
    }

    const previousDiscount = {
      percent: Number(student.discountPercent ?? 0),
      amount: Number(student.discountAmount ?? 0),
      reason: student.discountReason ?? null,
      monthlyFee: Number(student.monthlyFee ?? 0),
    };
    Object.assign(student, dto);
    const saved = await this.studentRepo.save(student);

    // Doimiy chegirma yoki shaxsiy narx o'zgarsa: shu oy uchun pul berilmagan
    // bo'lsa — shu oydan, berilgan bo'lsa — keyingi oydan kuchga kiradi
    // (o'tgan oylar tegilmaydi).
    const discountTouched =
      dto.discountPercent !== undefined ||
      dto.discountAmount !== undefined ||
      dto.monthlyFee !== undefined;
    let discountChanged = false;
    if (discountTouched) {
      const { effectiveFrom } = await this.baseDiscountService.setDiscount(
        saved.id,
        previousDiscount,
        {
          percent: Number(saved.discountPercent ?? 0),
          amount: Number(saved.discountAmount ?? 0),
          reason: saved.discountReason ?? null,
          monthlyFee: Number(saved.monthlyFee ?? 0),
        },
      );
      discountChanged = effectiveFrom !== null;
    }

    if (Array.isArray(discountPeriods)) {
      await this.replaceDiscountPeriodsForStudent(saved.id, discountPeriods);
    }

    // Tekin davr o'zgardi: qisqarsa bo'shab qolgan oylar uchun qator
    // yaratiladi, uzaysa ochiq qatorlar kamayadi (to'liq tekin — o'chadi).
    if (freeMonthsChanged && saved.status === StudentStatus.ACTIVE) {
      await this.paymentsService
        .ensurePaymentsForStudent(saved.id, {
          onlyCurrentMonth: false,
          maxMonthsBack: 3,
        })
        .catch(() => undefined);
    }

    // Guruhlar yuborilgan faol o'quvchi pastda baribir qayta hisoblanadi.
    const recalcBelow =
      shouldEnsureCurrentMonthPayments && saved.status === StudentStatus.ACTIVE;
    if ((discountChanged || freeMonthsChanged) && !recalcBelow) {
      await this.paymentsService
        .recalculateOpenPaymentsForStudent(saved.id, { maxMonthsBack: 3 })
        .catch(() => undefined);
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

    const changedFields = this.diffProfile(
      profileBefore,
      await this.snapshotProfile(saved, profileBefore.keys),
    );
    if (loginChanged) changedFields.push('login');
    // Parol xeshlangan — solishtirib bo'lmaydi; yuborilgan bo'lsa o'zgargan.
    if (passwordSent) changedFields.push('password');
    if (changedFields.length) {
      await this.studentEvents.log({
        studentId: saved.id,
        organizationId,
        type: StudentEventType.PROFILE_UPDATED,
        actorId,
        payload: { fields: changedFields },
      });
    }

    // Return the same enriched shape as findById so frontend always has ids
    return this.findById(organizationId, saved.id);
  }

  /**
   * Tarix uchun: tahrirdan oldin/keyin solishtiriladigan maydonlar. Guruhlar,
   * doimiy chegirma va shaxsiy narx bu yerda yo'q — ular o'z jadvalidan
   * (a'zolik oynalari, `student_base_discounts`) tarixda alohida ko'rinadi.
   * Qiymatlar yozilmaydi (pasport kabi maxfiy ma'lumot jurnalga tushmasin),
   * faqat qaysi maydon o'zgargani.
   */
  private static readonly PROFILE_FIELDS = [
    'firstName',
    'lastName',
    'phone',
    'secondPhone',
    'birthDate',
    'comment',
    'heardAboutUs',
    'preferredTime',
    'preferredDays',
    'passportSeries',
    'passportNumber',
    'jshshir',
    'freeMonths',
    'centerId',
  ] as const;

  private async snapshotProfile(
    student: Student,
    keysOrDto: UpdateStudentDto | string[],
  ): Promise<{ keys: string[]; values: Record<string, string> }> {
    const keys = Array.isArray(keysOrDto)
      ? keysOrDto
      : [
          ...StudentsService.PROFILE_FIELDS.filter(
            (k) => (keysOrDto as any)[k] !== undefined,
          ),
          ...((keysOrDto as any).subjectIds !== undefined ||
          (keysOrDto as any).subjectId !== undefined
            ? ['subjects']
            : []),
          ...((keysOrDto as any).referrerId !== undefined ? ['referrer'] : []),
        ];
    const norm = (v: unknown): string => {
      if (v == null || v === '') return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      // Sana DTO'da ISO bo'lib kelishi mumkin, bazada esa `YYYY-MM-DD`.
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
        return v.slice(0, 10);
      }
      if (Array.isArray(v)) return JSON.stringify([...v].map(String).sort());
      return String(v);
    };
    const values: Record<string, string> = {};
    for (const k of keys) {
      if (k === 'subjects') {
        const subjects = await this.studentRepo
          .createQueryBuilder()
          .relation(Student, 'subjects')
          .of(student.id)
          .loadMany<Subject>();
        values[k] = norm(subjects.map((x) => x.id));
      } else if (k === 'referrer') {
        const ref = await this.referralRepo.findOne({
          where: { referredStudentId: student.id as any },
        });
        values[k] = norm((ref as any)?.referrerStudentId);
      } else if (k === 'centerId') {
        values[k] = norm((student as any).centerId ?? student.center?.id);
      } else {
        values[k] = norm((student as any)[k]);
      }
    }
    return { keys, values };
  }

  private diffProfile(
    before: { keys: string[]; values: Record<string, string> },
    after: { values: Record<string, string> },
  ): string[] {
    return before.keys.filter((k) => before.values[k] !== after.values[k]);
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
      /** Eski guruhda `transferDate` dan boshlab yozilgan davomat (o'chiriladi). */
      attendanceAfterDate: number;
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

    const attendanceRows = dto.transferDate
      ? await this.studentRepo.manager
          .createQueryBuilder(Attendance, 'a')
          .select('a.studentId', 'studentId')
          .addSelect('COUNT(*)', 'count')
          .where('a.groupId = :groupId', { groupId: fromGroup.id })
          .andWhere('a.studentId IN (:...ids)', { ids: dto.studentIds })
          .andWhere('a.lessonDate >= :from', { from: dto.transferDate })
          .groupBy('a.studentId')
          .getRawMany<{ studentId: number; count: string }>()
      : [];
    const attendanceBy = new Map(
      attendanceRows.map((r) => [Number(r.studentId), Number(r.count)]),
    );

    return students.map((s) => ({
      studentId: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      debt: Number(byStudent.get(s.id)?.debt ?? 0),
      overpaid: Number(byStudent.get(s.id)?.overpaid ?? 0),
      attendanceAfterDate: attendanceBy.get(s.id) ?? 0,
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
      deletedAttendance: number;
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

      // 5) Davomat bitta guruhda bo'ladi: ko'chirish sanasidan boshlab eski
      //    guruhda yozilgan davomat o'chiriladi (orqaga sanalangan ko'chirishda
      //    o'sha darslar endi yangi guruhniki — pul ham, o'qituvchi foizi ham
      //    yangi guruhga o'tadi). Puldan KEYIN: hisob yiqilsa davomat
      //    yo'qolmaydi. Tartib hisobga ta'sir qilmaydi — eski guruhning
      //    to'lov kunlari `leftAt` gacha, o'chirilayotganlar esa undan keyin.
      const deleted = await this.studentRepo.manager
        .createQueryBuilder()
        .delete()
        .from(Attendance)
        .where('"studentId" = :studentId', { studentId: student.id })
        .andWhere('"groupId" = :groupId', { groupId: fromGroup.id })
        .andWhere('"lessonDate" >= :from', { from: transferDate })
        .execute();
      const deletedAttendance = Number(deleted.affected ?? 0);

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
        deletedAttendance,
      });

      await this.studentEvents.log({
        studentId: student.id,
        organizationId,
        type: StudentEventType.TRANSFERRED,
        actorId: currentUser?.userId ?? null,
        payload: {
          fromGroupId: fromGroup.id,
          fromGroupName: fromGroup.name,
          toGroupId: toGroup.id,
          toGroupName: toGroup.name,
          transferDate,
          reason: dto.reason?.trim() || null,
          carriedOverAmount: settlement.carriedOverAmount,
          refundedAmount: settlement.refundedAmount,
          remainingDebt: Number(debtRow?.debt ?? 0),
          deletedAttendance,
        },
      });
    }

    // 6) Kerak bo'lsa eski guruhni yopamiz (odam kam qolgani uchun yopilgan
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
    actorId?: number | null,
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

    const prevStatus = student.status;
    const groupIds: number[] = ((student as any).groups ?? []).map(
      (g: any) => g.id,
    );
    const today = this.todayInGroupTz((student as any).groups?.[0] ?? null);

    // ACTIVE ga o'tish:
    // - birinchi marta (new/ignored) — `activatedAt` shu payt, to'lov shundan;
    // - qaytib kelish (stopped/finished) — `activatedAt` TEGILMAYDI (u
    //   o'tgan oylarning quyi chegarasi, qayta yozilsa eski qarzlar o'chib
    //   ketardi). Buning o'rniga har bir guruhda yangi a'zolik oynasi
    //   ochiladi: to'xtab turgan davr to'lovga kirmaydi.
    const isReturn =
      prevStatus === StudentStatus.STOPPED ||
      prevStatus === StudentStatus.FINISHED;
    if (
      status === StudentStatus.ACTIVE &&
      prevStatus !== StudentStatus.ACTIVE
    ) {
      if (!isReturn || !student.activatedAt) {
        student.activatedAt = new Date();
      }
      student.stoppedAt = null;
    }

    // STOPPED — to'xtatilgan sana saqlanadi va barcha a'zolik oynalari shu
    // kuni yopiladi (keyingi darslar to'lovga kirmaydi).
    if (
      status === StudentStatus.STOPPED &&
      prevStatus !== StudentStatus.STOPPED
    ) {
      student.stoppedAt = new Date();
    }

    student.status = status;
    const saved = await this.studentRepo.save(student);

    await this.studentEvents.log({
      studentId: saved.id,
      organizationId,
      type: StudentEventType.STATUS_CHANGED,
      actorId,
      payload: {
        fromStatus: prevStatus,
        toStatus: status,
        returnLikelihood:
          status === StudentStatus.STOPPED || status === StudentStatus.IGNORED
            ? (body?.returnLikelihood ?? null)
            : null,
        comment: String(body?.comment ?? '').trim() || null,
      },
    });

    if (
      status === StudentStatus.STOPPED &&
      prevStatus !== StudentStatus.STOPPED
    ) {
      await this.enrollmentsService.closeAllForStudent(
        saved.id,
        today,
        "O'quvchi to'xtatildi",
      );
    }
    if (status === StudentStatus.ACTIVE && isReturn) {
      for (const gid of groupIds) {
        await this.enrollmentsService.open(saved.id, gid, today);
      }
      // Shu oyning o'zida qaytdi: to'xtatishda joriy oy to'xtagan kungacha
      // hisoblanib (ko'pincha PAID bo'lib) qolgan — yangi oyna bo'yicha
      // majburan qayta hisoblaymiz, aks holda oyning qolgan darslari bepul
      // qolardi. Avval "qaytariladigan" deb yozilgan pul qarzni yopishga qaytadi.
      await this.paymentsService
        .recalculateOpenPaymentsForStudent(saved.id, {
          maxMonthsBack: 1,
          includePaid: true,
          force: true,
        })
        .catch(() => undefined);
    }

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
