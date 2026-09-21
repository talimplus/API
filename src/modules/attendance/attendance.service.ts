import { Attendance } from '@/modules/attendance/entities/attendance.entity';
import { AttendanceLessonOverride } from '@/modules/attendance/entities/attendance-lesson-override.entity';
import { AttendanceStatus } from '@/modules/attendance/enums/attendance-status.enum';
import { GetLessonDatesQueryDto } from '@/modules/attendance/dto/get-lesson-dates.query.dto';
import { SubmitAttendanceDto } from '@/modules/attendance/dto/submit-attendance.dto';
import { RescheduleLessonDto } from '@/modules/attendance/dto/reschedule-lesson.dto';
import { computeLessonDates } from '@/modules/attendance/utils/lesson-dates';
import { Group } from '@/modules/groups/entities/groups.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';
import { dayjs } from '@/shared/utils/dayjs';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { UserRole } from '@/common/enums/user-role.enums';
import { PaymentsService } from '@/modules/payments/payments.service';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,

    @InjectRepository(AttendanceLessonOverride)
    private readonly overrideRepo: Repository<AttendanceLessonOverride>,

    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,

    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,

    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  private isAdminRole(role: UserRole): boolean {
    return [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER].includes(
      role,
    );
  }

  private async getGroupOrThrow(groupId: number) {
    const group = await this.groupRepo.findOne({
      where: { id: groupId },
      relations: ['teacher', 'center', 'schedules', 'students'],
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  private assertCanAccessGroup(user: any, group: Group) {
    if (!user) throw new ForbiddenException('Unauthorized');

    if (user.role === UserRole.TEACHER) {
      if (!group.teacher?.id || group.teacher.id !== user.userId) {
        throw new ForbiddenException('Teacher is not assigned to this group');
      }
    }

    // Basic center-level isolation for non-super admins (keeps behavior consistent with other modules)
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.centerId &&
      group.center?.id
    ) {
      if (group.center.id !== user.centerId) {
        throw new ForbiddenException('Not allowed to access this group');
      }
    }
  }

  private getTodayInGroupTz(timezone: string): string {
    return dayjs().tz(timezone).format('YYYY-MM-DD');
  }

  private formatDateOnly(input: Date | string): string {
    return dayjs.utc(input).format('YYYY-MM-DD');
  }

  /**
   * Guruhdagi har bir o'quvchining SHU GURUHGA qo'shilgan sanasi
   * (students_groups_groups.joinedAt), guruh timezone'ida YYYY-MM-DD.
   *
   * Nega kerak: o'quvchi darslar boshlanganidan keyin qo'shilgan bo'lsa,
   * qo'shilishidan OLDINGI darslar uning darslari emas — ularga davomat
   * yozilmasligi kerak. Bu to'lov bilan bir xil chegara: payments proratsiyasi
   * ham aynan shu joinedAt dan boshlanadi (getEnrollmentJoinedAt).
   *
   * joinedAt ustuni hali bo'lmasa (migratsiya ishlamagan) bo'sh map qaytaramiz —
   * ya'ni eski (cheklovsiz) xatti-harakat saqlanadi.
   */
  private async getJoinDatesByStudent(
    groupId: number,
    timezone: string,
  ): Promise<Map<number, { joinedAt: string; leftAt: string | null }>> {
    const map = new Map<number, { joinedAt: string; leftAt: string | null }>();

    // Asosiy manba — a'zolik oynalari (o'quvchi chiqib ketgan bo'lsa ham qoladi).
    try {
      const rows = await this.groupRepo.manager.query(
        `SELECT "studentId", "joinedAt", "leftAt"
           FROM "student_group_enrollments"
          WHERE "groupId" = $1
          ORDER BY "joinedAt" ASC`,
        [groupId],
      );
      for (const r of rows ?? []) {
        if (!r?.joinedAt) continue;
        const joinedAt = dayjs(r.joinedAt).format('YYYY-MM-DD');
        const leftAt = r.leftAt ? dayjs(r.leftAt).format('YYYY-MM-DD') : null;
        const prev = map.get(Number(r.studentId));
        if (!prev) {
          map.set(Number(r.studentId), { joinedAt, leftAt });
          continue;
        }
        map.set(Number(r.studentId), {
          joinedAt: joinedAt < prev.joinedAt ? joinedAt : prev.joinedAt,
          leftAt:
            prev.leftAt === null || leftAt === null
              ? null
              : leftAt > prev.leftAt
                ? leftAt
                : prev.leftAt,
        });
      }
      if (map.size) return map;
    } catch {
      // jadval yo'q (migratsiya ishlamagan) — junction'ga tushamiz
    }

    try {
      const rows = await this.groupRepo.manager.query(
        `SELECT "studentsId" AS "studentId", "joinedAt"
           FROM "students_groups_groups"
          WHERE "groupsId" = $1`,
        [groupId],
      );
      for (const r of rows ?? []) {
        if (!r?.joinedAt) continue;
        const d = dayjs(new Date(r.joinedAt)).tz(timezone);
        if (d.isValid()) {
          map.set(Number(r.studentId), {
            joinedAt: d.format('YYYY-MM-DD'),
            leftAt: null,
          });
        }
      }
    } catch {
      // ustun yo'q / so'rov bajarilmadi — cheklov qo'llanmaydi
    }
    return map;
  }

  /**
   * Jurnal qatorlari: guruhdagi hozirgi o'quvchilar + ko'rsatilayotgan
   * oraliqda shu guruhda o'qigan, keyin chiqib ketganlar (tarix uchun,
   * `leftAt` dan keyin faqat o'qish uchun).
   */
  private async buildJournalStudents(args: {
    group: Group;
    windows: Map<number, { joinedAt: string; leftAt: string | null }>;
    rangeFrom: string | null;
    rangeTo: string | null;
  }) {
    const { group, windows, rangeFrom, rangeTo } = args;

    const rows = new Map<
      number,
      {
        id: number;
        firstName: string;
        lastName: string;
        joinedAt: string | null;
        leftAt: string | null;
      }
    >();

    for (const s of group.students ?? []) {
      const w = windows.get(s.id);
      rows.set(s.id, {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        joinedAt: w?.joinedAt ?? null,
        leftAt: w?.leftAt ?? null,
      });
    }

    // Chiqib ketganlar: oynasi ko'rsatilayotgan oraliq bilan kesishsa qo'shamiz.
    const leftIds = Array.from(windows.entries())
      .filter(([studentId, w]) => {
        if (rows.has(studentId)) return false;
        if (!w.leftAt) return false;
        if (!rangeFrom || !rangeTo) return false;
        return w.joinedAt <= rangeTo && w.leftAt > rangeFrom;
      })
      .map(([studentId]) => studentId);

    if (leftIds.length) {
      const leftStudents = await this.studentRepo.find({
        where: { id: In(leftIds) },
        select: ['id', 'firstName', 'lastName'],
      });
      for (const s of leftStudents) {
        const w = windows.get(s.id);
        rows.set(s.id, {
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          joinedAt: w?.joinedAt ?? null,
          leftAt: w?.leftAt ?? null,
        });
      }
    }

    return Array.from(rows.values()).sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
      ),
    );
  }

  private async findOverridesForDate(groupId: number, lessonDate: string) {
    return this.overrideRepo.find({
      where: [
        { groupId, fromDate: lessonDate as any },
        { groupId, toDate: lessonDate as any },
      ],
    });
  }

  private async getOverridesForRange(
    groupId: number,
    from: string,
    to: string,
  ) {
    return this.overrideRepo.find({
      where: [
        { groupId, fromDate: Between(from as any, to as any) },
        { groupId, toDate: Between(from as any, to as any) },
      ],
      order: { fromDate: 'ASC' },
    });
  }

  private computeLessonDatesForGroup(
    group: Group,
    query: GetLessonDatesQueryDto,
  ): string[] {
    const timezone = group.timezone || 'Asia/Tashkent';
    const startDate = dayjs(group.startDate).format('YYYY-MM-DD');
    const endDate = group.endDate
      ? dayjs(group.endDate).format('YYYY-MM-DD')
      : null;

    const mode = query.mode ?? 'last';
    if (mode === 'last') {
      const count = query.count ?? 7;
      return computeLessonDates({
        timezone,
        groupStartDate: startDate,
        groupEndDate: endDate,
        schedules: group.schedules ?? [],
        window: { mode: 'last', count },
      });
    }

    // mode === 'range': graceful defaults
    // - if both missing -> error
    // - if only from -> to = today (group timezone)
    // - if only to -> from = group.startDate
    if (!query.from && !query.to) {
      throw new BadRequestException("mode='range' requires from and/or to");
    }

    const from = query.from ?? startDate;
    const to = query.to ?? dayjs().tz(timezone).format('YYYY-MM-DD');

    return computeLessonDates({
      timezone,
      groupStartDate: startDate,
      groupEndDate: endDate,
      schedules: group.schedules ?? [],
      window: { mode: 'range', from, to },
    });
  }

  async getLessonDatesView(
    groupId: number,
    query: GetLessonDatesQueryDto,
    user: any,
  ) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanAccessGroup(user, group);

    const timezone = group.timezone || 'Asia/Tashkent';
    const today = dayjs().tz(timezone).format('YYYY-MM-DD');

    // Har bir o'quvchining shu guruhdagi a'zolik oynasi — front `joinedAt` dan
    // oldingi va `leftAt` dan keyingi kataklarni tahrirlanmaydigan qiladi.
    const joinDates = await this.getJoinDatesByStudent(groupId, timezone);

    const lessonDates = this.computeLessonDatesForGroup(group, query);

    // Ro'yxatga guruhdan chiqib ketgan (boshqa guruhga ko'chirilgan) o'quvchilar
    // ham kiradi — agar ular ko'rsatilayotgan oraliqda o'qigan bo'lsa. Aks holda
    // ularning davomat tarixi jurnaldan butunlay yo'qolib qolardi.
    const students = await this.buildJournalStudents({
      group,
      windows: joinDates,
      rangeFrom: lessonDates[0] ?? null,
      rangeTo: lessonDates[lessonDates.length - 1] ?? null,
    });

    if (!lessonDates.length) {
      if (query.mode === 'range' && (query.from || query.to)) {
        const startDate = dayjs(group.startDate).format('YYYY-MM-DD');
        const from = query.from ?? startDate;
        const to = query.to ?? today;
        const overrides = await this.getOverridesForRange(groupId, from, to);

        const overridesByDate: Record<string, any> = {};
        const extraDates: string[] = [];

        for (const o of overrides) {
          const fromDate = this.formatDateOnly(o.fromDate);
          const toDate = this.formatDateOnly(o.toDate);
          overridesByDate[fromDate] = {
            id: o.id,
            type: 'cancelled',
            movedTo: toDate,
            reason: o.reason ?? null,
          };
          overridesByDate[toDate] = {
            id: o.id,
            type: 'extra',
            movedFrom: fromDate,
            reason: o.reason ?? null,
          };
          if (!extraDates.includes(toDate)) extraDates.push(toDate);
        }

        const uniqueDates = Array.from(new Set(extraDates)).sort();
        const attendanceByDate: Record<string, any> = {};
        for (const d of uniqueDates) {
          attendanceByDate[d] = { exists: false, rows: [] };
        }

        return {
          timezone,
          today,
          students,
          lessonDates: uniqueDates,
          overridesByDate,
          attendanceByDate,
        };
      }

      return {
        timezone,
        today,
        students,
        lessonDates: [],
        attendanceByDate: {},
      };
    }

    const rangeFrom =
      query.mode === 'range' && (query.from || query.to)
        ? (query.from ?? dayjs(group.startDate).format('YYYY-MM-DD'))
        : lessonDates[0];
    const rangeTo =
      query.mode === 'range' && (query.from || query.to)
        ? (query.to ?? today)
        : lessonDates[lessonDates.length - 1];

    const overrides =
      rangeFrom && rangeTo
        ? await this.getOverridesForRange(groupId, rangeFrom, rangeTo)
        : [];

    const overridesByDate: Record<string, any> = {};
    const extraDates: string[] = [];

    for (const o of overrides) {
      const fromDate = this.formatDateOnly(o.fromDate);
      const toDate = this.formatDateOnly(o.toDate);
      overridesByDate[fromDate] = {
        id: o.id,
        type: 'cancelled',
        movedTo: toDate,
        reason: o.reason ?? null,
      };
      overridesByDate[toDate] = {
        id: o.id,
        type: 'extra',
        movedFrom: fromDate,
        reason: o.reason ?? null,
      };
      if (!extraDates.includes(toDate)) extraDates.push(toDate);
    }

    const combinedDates = Array.from(
      new Set([...lessonDates, ...extraDates]),
    ).sort();

    const rows = await this.attendanceRepo.find({
      where: {
        groupId,
        lessonDate: In(combinedDates as any),
      },
      relations: ['student'],
      order: { lessonDate: 'ASC', studentId: 'ASC' },
    });

    const byDate: Record<string, any> = {};
    for (const d of combinedDates) {
      byDate[d] = { exists: false, rows: [] };
    }

    for (const r of rows) {
      const key = dayjs(r.lessonDate).format('YYYY-MM-DD');
      if (!byDate[key]) byDate[key] = { exists: false, rows: [] };
      byDate[key].exists = true;
      byDate[key].rows.push({
        id: r.id,
        groupId: r.groupId,
        studentId: r.studentId,
        lessonDate: key,
        status: r.status,
        comment: r.comment ?? null,
        submittedById: r.submittedById ?? null,
        submittedAt: r.submittedAt?.toISOString?.() ?? String(r.submittedAt),
        updatedAt: r.updatedAt?.toISOString?.() ?? String(r.updatedAt),
        student: r.student,
      });
    }

    return {
      timezone,
      today,
      students,
      lessonDates: combinedDates,
      overridesByDate,
      attendanceByDate: byDate,
    };
  }

  async submitAttendance(groupId: number, dto: SubmitAttendanceDto, user: any) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanAccessGroup(user, group);

    if (group.status !== GroupStatus.STARTED) {
      throw new BadRequestException(
        'Faqat boshlangan guruhlar uchun davomat yozish mumkin',
      );
    }

    if (!group.schedules?.length) {
      throw new BadRequestException('Group schedule is not configured');
    }

    const timezone = group.timezone || 'Asia/Tashkent';
    const today = this.getTodayInGroupTz(timezone);

    const isAdmin = this.isAdminRole(user.role);
    const isTeacher = user.role === UserRole.TEACHER;
    const isReception = user.role === UserRole.RECEPTION;

    // Teacher can submit for today or any past date within the current month
    // (group TZ). Admin and reception can override any past date. Future is
    // blocked below.
    if (isTeacher && dto.lessonDate !== today) {
      const monthStart = dayjs.tz(today, timezone).startOf('month');
      const lessonDay = dayjs.tz(dto.lessonDate, timezone);
      if (lessonDay.isBefore(monthStart)) {
        throw new ForbiddenException(
          'Teachers can submit only for dates within the current month',
        );
      }
    }
    if (!isAdmin && !isTeacher && !isReception) {
      throw new ForbiddenException('Not allowed');
    }
    // Disallow future submissions for now (keeps "no invented future facts")
    if (dayjs.tz(dto.lessonDate, timezone).isAfter(dayjs.tz(today, timezone))) {
      throw new ForbiddenException('Cannot submit for future dates');
    }

    // Validate lessonDate is a real lesson date (schedule + overrides + boundaries)
    const overrides = await this.findOverridesForDate(groupId, dto.lessonDate);
    let isExtraLessonDate = false;
    for (const o of overrides) {
      const fromDate = this.formatDateOnly(o.fromDate);
      const toDate = this.formatDateOnly(o.toDate);
      if (fromDate === dto.lessonDate) {
        throw new BadRequestException(
          `lessonDate was rescheduled to ${toDate}`,
        );
      }
      if (toDate === dto.lessonDate) {
        isExtraLessonDate = true;
      }
    }

    const groupStartDate = dayjs(group.startDate).format('YYYY-MM-DD');
    const groupEndDate = group.endDate
      ? dayjs(group.endDate).format('YYYY-MM-DD')
      : null;
    if (!isExtraLessonDate) {
      const valid = computeLessonDates({
        timezone,
        groupStartDate,
        groupEndDate,
        schedules: group.schedules,
        window: { mode: 'range', from: dto.lessonDate, to: dto.lessonDate },
      });
      if (!valid.includes(dto.lessonDate)) {
        throw new BadRequestException(
          'lessonDate is not a scheduled lesson date',
        );
      }
    }

    // Validate students belong to group (current membership model has no date ranges)
    const allowedStudentIds = new Set((group.students ?? []).map((s) => s.id));
    const unknown = dto.items.filter(
      (i) => !allowedStudentIds.has(i.studentId),
    );
    if (unknown.length) {
      throw new BadRequestException(
        `Some students are not in this group: ${unknown
          .map((i) => i.studentId)
          .join(', ')}`,
      );
    }

    // O'quvchining a'zolik oynasidan TASHQARIDAGI darslarga davomat yozilmaydi:
    // u darslarda o'quvchi hali guruhda bo'lmagan yoki allaqachon chiqib ketgan.
    // Chegara to'lov bilan bir xil (proratsiya ham joinedAt…leftAt oralig'ida),
    // shuning uchun davomat hisoboti va to'lov bir-biriga mos bo'ladi.
    const joinDates = await this.getJoinDatesByStudent(groupId, timezone);
    const nameById = new Map(
      (group.students ?? []).map((s) => [s.id, `${s.firstName} ${s.lastName}`]),
    );

    const beforeJoin = dto.items.filter((i) => {
      const w = joinDates.get(i.studentId);
      return !!w?.joinedAt && dto.lessonDate < w.joinedAt;
    });
    if (beforeJoin.length) {
      throw new BadRequestException(
        `Bu o'quvchilar guruhga keyinroq qo'shilgan, ${dto.lessonDate} sanasidagi darsga davomat yozib bo'lmaydi: ` +
          beforeJoin
            .map(
              (i) =>
                `${nameById.get(i.studentId) ?? i.studentId} (${
                  joinDates.get(i.studentId)?.joinedAt
                } dan)`,
            )
            .join(', '),
      );
    }

    // `leftAt` — exclusive: chiqqan kunidagi dars ham uniki emas.
    const afterLeave = dto.items.filter((i) => {
      const w = joinDates.get(i.studentId);
      return !!w?.leftAt && dto.lessonDate >= w.leftAt;
    });
    if (afterLeave.length) {
      throw new BadRequestException(
        `Bu o'quvchilar guruhdan chiqqan, ${dto.lessonDate} sanasidagi darsga davomat yozib bo'lmaydi: ` +
          afterLeave
            .map(
              (i) =>
                `${nameById.get(i.studentId) ?? i.studentId} (${
                  joinDates.get(i.studentId)?.leftAt
                } dan chiqqan)`,
            )
            .join(', '),
      );
    }

    // Excused (sababli) requires a reason so it is auditable and so payment
    // deductions are justified.
    const missingReason = dto.items.filter(
      (i) =>
        i.status === AttendanceStatus.EXCUSED &&
        !(i.comment && i.comment.trim()),
    );
    if (missingReason.length) {
      throw new BadRequestException(
        `Sababli (excused) qilish uchun sabab yozilishi shart: studentId ${missingReason
          .map((i) => i.studentId)
          .join(', ')}`,
      );
    }

    const now = new Date();
    const upsertRows = dto.items.map((i) => ({
      groupId,
      studentId: i.studentId,
      lessonDate: dto.lessonDate as any,
      status: i.status ?? AttendanceStatus.PRESENT,
      comment: i.comment ?? null,
      submittedById: user.userId,
      submittedAt: now,
      updatedAt: now,
    }));

    await this.attendanceRepo.upsert(upsertRows, [
      'groupId',
      'studentId',
      'lessonDate',
    ]);

    // Recalculate payments for affected students: EXCUSED lessons are deducted
    // from billing, and flipping a lesson back to PRESENT/ABSENT restores it.
    // Failures here must not break attendance submission.
    const affectedStudentIds = Array.from(
      new Set(dto.items.map((i) => i.studentId)),
    );
    for (const sid of affectedStudentIds) {
      try {
        await this.paymentsService.recalcPaymentForAttendanceChange(
          sid,
          groupId,
          dto.lessonDate,
        );
      } catch (e) {
        this.logger.warn(
          `Payment recalc failed after attendance for student ${sid}: ${
            (e as any)?.message ?? e
          }`,
        );
      }
    }

    // return persisted rows for that date
    const rows = await this.attendanceRepo.find({
      where: { groupId, lessonDate: dto.lessonDate as any },
      relations: ['student'],
      order: { studentId: 'ASC' },
    });

    return rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      studentId: r.studentId,
      lessonDate: dayjs(r.lessonDate).format('YYYY-MM-DD'),
      status: r.status,
      comment: r.comment ?? null,
      submittedById: r.submittedById ?? null,
      submittedAt: r.submittedAt?.toISOString?.() ?? String(r.submittedAt),
      updatedAt: r.updatedAt?.toISOString?.() ?? String(r.updatedAt),
      student: r.student,
    }));
  }

  async getAttendanceReport(
    groupId: number,
    from: string,
    to: string,
    user: any,
  ) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanAccessGroup(user, group);

    if (!from || !to) throw new BadRequestException('from and to are required');
    if (dayjs(to).isBefore(dayjs(from))) {
      throw new BadRequestException('to must be >= from');
    }

    const rows = await this.attendanceRepo.find({
      where: {
        groupId,
        lessonDate: Between(from as any, to as any),
      },
      relations: ['student'],
      order: { lessonDate: 'ASC', studentId: 'ASC' },
    });

    // DB-driven only: return only existing rows (no schedule gaps filled)
    return rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      studentId: r.studentId,
      lessonDate: dayjs(r.lessonDate).format('YYYY-MM-DD'),
      status: r.status,
      comment: r.comment ?? null,
      submittedById: r.submittedById ?? null,
      submittedAt: r.submittedAt?.toISOString?.() ?? String(r.submittedAt),
      updatedAt: r.updatedAt?.toISOString?.() ?? String(r.updatedAt),
      student: r.student,
    }));
  }

  async rescheduleLesson(groupId: number, dto: RescheduleLessonDto, user: any) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanAccessGroup(user, group);

    if (group.status !== GroupStatus.STARTED) {
      throw new BadRequestException(
        "Faqat boshlangan guruhlar uchun dars ko'chirish mumkin",
      );
    }

    const timezone = group.timezone || 'Asia/Tashkent';
    const today = this.getTodayInGroupTz(timezone);
    const fromDate = (dto as any).fromDate || today;

    if (fromDate === dto.toDate) {
      throw new BadRequestException('toDate must be different from fromDate');
    }

    if (dayjs.tz(dto.toDate, timezone).isBefore(dayjs.tz(today, timezone))) {
      throw new BadRequestException('toDate cannot be in the past');
    }

    if (dayjs.tz(fromDate, timezone).isBefore(dayjs.tz(today, timezone))) {
      throw new BadRequestException('fromDate cannot be in the past');
    }

    const groupStartDate = dayjs(group.startDate).format('YYYY-MM-DD');
    const groupEndDate = group.endDate
      ? dayjs(group.endDate).format('YYYY-MM-DD')
      : null;

    const toDateTz = dayjs.tz(dto.toDate, timezone).startOf('day');
    const startDateTz = dayjs.tz(groupStartDate, timezone).startOf('day');
    const endDateTz = groupEndDate
      ? dayjs.tz(groupEndDate, timezone).startOf('day')
      : null;

    if (toDateTz.isBefore(startDateTz)) {
      throw new BadRequestException('toDate is before group start date');
    }
    if (endDateTz && toDateTz.isAfter(endDateTz)) {
      throw new BadRequestException('toDate is after group end date');
    }

    const fromValid = computeLessonDates({
      timezone,
      groupStartDate,
      groupEndDate,
      schedules: group.schedules ?? [],
      window: { mode: 'range', from: fromDate, to: fromDate },
    });
    if (!fromValid.includes(fromDate)) {
      throw new BadRequestException('fromDate is not a scheduled lesson date');
    }

    const toIsScheduled = computeLessonDates({
      timezone,
      groupStartDate,
      groupEndDate,
      schedules: group.schedules ?? [],
      window: { mode: 'range', from: dto.toDate, to: dto.toDate },
    });
    if (toIsScheduled.includes(dto.toDate)) {
      throw new BadRequestException(
        'toDate is already a scheduled lesson date',
      );
    }

    const existingFrom = await this.overrideRepo.findOne({
      where: { groupId, fromDate: fromDate as any },
    });
    if (existingFrom) {
      throw new BadRequestException('fromDate is already rescheduled');
    }

    const existingTo = await this.overrideRepo.findOne({
      where: { groupId, toDate: dto.toDate as any },
    });
    if (existingTo) {
      throw new BadRequestException(
        'toDate is already used by another reschedule',
      );
    }

    const fromAttendanceCount = await this.attendanceRepo.count({
      where: { groupId, lessonDate: fromDate as any },
    });
    if (fromAttendanceCount) {
      throw new BadRequestException(
        'Attendance already submitted for fromDate',
      );
    }

    const toAttendanceCount = await this.attendanceRepo.count({
      where: { groupId, lessonDate: dto.toDate as any },
    });
    if (toAttendanceCount) {
      throw new BadRequestException('Attendance already submitted for toDate');
    }

    const saved = await this.overrideRepo.save({
      groupId,
      fromDate: fromDate as any,
      toDate: dto.toDate as any,
      reason: dto.reason ?? null,
      createdById: user.userId,
    });

    return {
      id: saved.id,
      groupId,
      fromDate: this.formatDateOnly(saved.fromDate),
      toDate: this.formatDateOnly(saved.toDate),
      reason: saved.reason ?? null,
      createdById: saved.createdById ?? null,
      createdAt: saved.createdAt?.toISOString?.() ?? String(saved.createdAt),
    };
  }
}
