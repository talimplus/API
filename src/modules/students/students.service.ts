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

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(StudentDiscountPeriod)
    private readonly discountPeriodRepo: Repository<StudentDiscountPeriod>,
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
    }: {
      centerId?: number;
      name?: string;
      phone?: string;
      page?: number;
      status: StudentStatus;
      perPage?: number;
      groupId?: number;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.studentRepo
      .createQueryBuilder('student')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .leftJoin('student.groups', 'group')
      .where('organization.id = :organizationId', { organizationId });

    if (centerId) query.andWhere('center.id = :centerId', { centerId });
    if (name) {
      query.andWhere(
        '(student.firstName ILIKE :name OR student.lastName ILIKE :name)',
        { name: `%${name}%` },
      );
    }

    if (status) {
      query.andWhere('student.status = :status', { status });
    }

    if (phone)
      query.andWhere('student.phone ILIKE :phone', { phone: `%${phone}%` });

    if (groupId) {
      query.andWhere('group.id = :groupId', { groupId });
    }

    const [data, total] = await query
      .orderBy('student.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();
    return {
      data: instanceToPlain(data),
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
    return this.studentRepo.find({
      where: {
        center: {
          id: centerId,
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

  async getReferredStudents(organizationId: number, centerId?: number) {
    const query = this.studentRepo
      .createQueryBuilder('student')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere('student.status IN (:...statuses)', {
        statuses: [StudentStatus.NEW, StudentStatus.ACTIVE],
      });

    if (centerId) {
      query.andWhere('center.id = :centerId', { centerId });
    }

    const students = await query.orderBy('student.createdAt', 'DESC').getMany();

    return instanceToPlain(students);
  }

  async findById(id: number) {
    const student = await this.studentRepo.findOne({
      where: { id },
      relations: ['user', 'center'],
    });

    if (!student) throw new NotFoundException('O‘quvchi topilmadi');

    const result: any = instanceToPlain(student);

    // Faqat parol o‘zgartirilmagan bo‘lsa, `tempPassword` ni qaytaramiz
    result.login = student.user.login;

    // Parolni qayta generatsiya qilish
    const birth = student.birthDate ? new Date(student.birthDate) : new Date();
    const formattedBirth = `${birth.getFullYear()}${String(birth.getMonth() + 1).padStart(2, '0')}${String(birth.getDate()).padStart(2, '0')}`;
    result.tempPassword = `${student.firstName.toLowerCase()}${student.lastName.toLowerCase()}${formattedBirth}`;

    return result;
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
      if (to && dayjs(to).isBefore(dayjs(from))) {
        throw new BadRequestException('toMonth must be >= fromMonth');
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

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevToMonth = prev.toMonth ?? '9999-12-01';
      if (dayjs(prevToMonth).isSame(dayjs(curr.fromMonth)) || dayjs(prevToMonth).isAfter(dayjs(curr.fromMonth))) {
        throw new BadRequestException('Discount periods overlap for this student');
      }
    }

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

  private async ensureNoOverlap(
    studentId: number,
    fromMonth: string, // YYYY-MM-01
    toMonth: string | null, // YYYY-MM-01
    excludeId?: number,
  ) {
    const qb = this.discountPeriodRepo
      .createQueryBuilder('d')
      .where('d.studentId = :studentId', { studentId })
      .andWhere('d.fromMonth <= :newTo', {
        newTo: (toMonth ?? '9999-12-01') as any,
      })
      .andWhere('(d.toMonth IS NULL OR d.toMonth >= :newFrom)', {
        newFrom: fromMonth as any,
      });

    if (excludeId) qb.andWhere('d.id != :excludeId', { excludeId });

    const overlap = await qb.getOne();
    if (overlap) {
      throw new BadRequestException('Discount periods overlap for this student');
    }
  }

  async createDiscountPeriod(
    organizationId: number,
    studentId: number,
    dto: { percent: number; fromMonth: string; toMonth?: string | null; reason?: string },
  ) {
    await this.assertStudentInOrganization(organizationId, studentId);

    const from = this.normalizeMonth(dto.fromMonth);
    const to = dto.toMonth ? this.normalizeMonth(dto.toMonth) : null;
    if (to && dayjs(to).isBefore(dayjs(from))) {
      throw new BadRequestException('toMonth must be >= fromMonth');
    }

    await this.ensureNoOverlap(studentId, from, to);

    const row = this.discountPeriodRepo.create({
      studentId,
      percent: Number(dto.percent),
      fromMonth: from as any,
      toMonth: (to as any) ?? null,
      reason: dto.reason ?? null,
    });
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
    dto: { percent?: number; fromMonth?: string; toMonth?: string | null; reason?: string },
  ) {
    await this.assertStudentInOrganization(organizationId, studentId);

    const existing = await this.discountPeriodRepo.findOne({
      where: { id: periodId, studentId },
    });
    if (!existing) throw new NotFoundException('Discount period not found');

    const from = dto.fromMonth ? this.normalizeMonth(dto.fromMonth) : dayjs(existing.fromMonth).format('YYYY-MM-01');
    const to =
      dto.toMonth !== undefined
        ? dto.toMonth
          ? this.normalizeMonth(dto.toMonth)
          : null
        : existing.toMonth
          ? dayjs(existing.toMonth).format('YYYY-MM-01')
          : null;

    if (to && dayjs(to).isBefore(dayjs(from))) {
      throw new BadRequestException('toMonth must be >= fromMonth');
    }

    await this.ensureNoOverlap(studentId, from, to, periodId);

    if (dto.percent !== undefined) existing.percent = Number(dto.percent) as any;
    existing.fromMonth = from as any;
    existing.toMonth = (to as any) ?? null;
    if (dto.reason !== undefined) existing.reason = dto.reason ?? null;

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

    const center = await this.centerService.findOne(centerId);
    if (!center) throw new NotFoundException('Bunday center mavjud emas');
    const organization =
      await this.organizationsService.findById(organizationId);

    if (!organization.id) {
      throw new BadRequestException('Bunday organizatsiya mavjud emas');
    }

    const groupIds = dto.groupIds;

    const groups = await this.groupRepo.findBy({ id: In(groupIds) });
    const birth = dto.birthDate ? new Date(dto.birthDate) : new Date();
    const formattedBirth = `${birth.getFullYear()}${String(birth.getMonth() + 1).padStart(2, '0')}${String(birth.getDate()).padStart(2, '0')}`;
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
        centerId: centerId || dto.centerId,
      },
      organizationId,
      role,
    );

    if (!user) throw new BadRequestException('Nomalum xatolik');

    const student = this.studentRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      monthlyFee: dto.monthlyFee,
      discountPercent: dto.discountPercent ?? 0,
      discountReason: dto.discountReason ?? null,
      birthDate: dto.birthDate,
      status: StudentStatus.NEW,
      center,
      user,
      groups: groups,
    });

    const savedStudent = await this.studentRepo.save(student);

    if (Array.isArray(discountPeriods)) {
      await this.replaceDiscountPeriodsForStudent(savedStudent.id, discountPeriods);
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

  async update(id: number, dto: UpdateStudentDto) {
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

    const student = await this.findById(id);
    const user = await this.userService.findOne(student.user.id);
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

    return instanceToPlain(saved);
  }

  async changeStatus(id: number, status: StudentStatus) {
    const student = await this.studentRepo.findOne({ where: { id } });
    if (!student) throw new NotFoundException('O‘quvchi topilmadi');

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
