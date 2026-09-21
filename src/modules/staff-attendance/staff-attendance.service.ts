import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { UserRole } from '@/common/enums/user-role.enums';
import { getClientIp } from '@/shared/utils/request-ip';
import { Group } from '@/modules/groups/entities/groups.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { User } from '@/modules/users/entities/user.entity';
import { AttendanceLessonOverride } from '@/modules/attendance/entities/attendance-lesson-override.entity';
import { computeLessonDates } from '@/modules/attendance/utils/lesson-dates';
import { StaffAttendance } from './entities/staff-attendance.entity';
import {
  AttendanceConfidence,
  AttendanceFlag,
  AttendanceSource,
} from './enums/staff-attendance.enum';
import { CheckInDto } from './dto/check-in.dto';
import { ManualCheckInDto } from './dto/manual-check-in.dto';
import { QueryStaffAttendanceDto } from './dto/query-staff-attendance.dto';
import { distanceInMeters } from './utils/geo';

const weekDayToDow: Record<WeekDay, number> = {
  [WeekDay.SUNDAY]: 0,
  [WeekDay.MONDAY]: 1,
  [WeekDay.TUESDAY]: 2,
  [WeekDay.WEDNESDAY]: 3,
  [WeekDay.THURSDAY]: 4,
  [WeekDay.FRIDAY]: 5,
  [WeekDay.SATURDAY]: 6,
};

/** GPS shundan yomon bo'lsa radius tekshiruviga ishonmaymiz */
const MAX_TRUSTED_ACCURACY_METERS = 500;

/** Bitta qurilmadan boshqa xodim kirganini shuncha kun orqaga qarab tekshiramiz */
const SHARED_DEVICE_LOOKBACK_DAYS = 60;

const DEFAULT_TIMEZONE = 'Asia/Tashkent';

type LessonDay = { date: string; startTime: string };

@Injectable()
export class StaffAttendanceService {
  constructor(
    @InjectRepository(StaffAttendance)
    private readonly repo: Repository<StaffAttendance>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AttendanceLessonOverride)
    private readonly overrideRepo: Repository<AttendanceLessonOverride>,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // "Keldim"
  // ─────────────────────────────────────────────────────────────

  /**
   * Xodimning o'zi "Keldim" bosdi.
   *
   * Hech qanday shart bloklamaydi — joylashuv berilmasa ham, markaz Wi-Fi'sida
   * bo'lmasa ham yozuv yaratiladi. Farq faqat `confidence` va `flags` da.
   */
  async checkIn(reqUser: any, dto: CheckInDto, req: any) {
    const center = await this.loadCenter(reqUser.centerId);
    const timezone = center?.timezone || DEFAULT_TIMEZONE;
    const now = dayjs().tz(timezone);
    const workDate = now.format('YYYY-MM-DD');

    const existing = await this.repo.findOne({
      where: { userId: reqUser.userId, workDate: workDate as any },
      relations: ['user'],
    });
    // Takroriy bosish xato emas — bor yozuvni qaytaramiz (kuniga bitta qator)
    if (existing) {
      return { alreadyCheckedIn: true, attendance: this.toView(existing) };
    }

    const lessons = await this.teacherLessonDays(
      reqUser.userId,
      workDate,
      workDate,
    );
    const firstLessonAt = lessons.get(workDate) ?? null;

    let lateMinutes = 0;
    if (firstLessonAt) {
      const lessonStart = dayjs.tz(`${workDate} ${firstLessonAt}`, timezone);
      lateMinutes = Math.max(0, now.diff(lessonStart, 'minute'));
    }

    const evidence = await this.evaluateEvidence(
      reqUser.userId,
      center,
      dto,
      req,
    );

    const flags = [...evidence.flags];
    if (!firstLessonAt) flags.push(AttendanceFlag.NO_LESSON_TODAY);

    const saved = await this.repo.save(
      this.repo.create({
        userId: reqUser.userId,
        centerId: reqUser.centerId ?? null,
        organizationId: reqUser.organizationId,
        workDate: workDate as any,
        checkInAt: new Date(),
        firstLessonAt,
        lateMinutes,
        source: AttendanceSource.SELF,
        confidence: evidence.confidence,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        accuracyMeters: dto.accuracyMeters ?? null,
        distanceMeters: evidence.distanceMeters,
        geoMatched: evidence.geoMatched,
        ip: evidence.ip,
        ipMatched: evidence.ipMatched,
        deviceId: dto.deviceId ?? null,
        userAgent:
          String(req?.headers?.['user-agent'] ?? '').slice(0, 255) || null,
        flags: flags.length ? flags : null,
      }),
    );

    const withUser = await this.repo.findOne({
      where: { id: saved.id },
      relations: ['user'],
    });

    return {
      alreadyCheckedIn: false,
      attendance: this.toView(withUser ?? saved),
    };
  }

  /** Xodimning o'z bugungi holati (tugma qanday ko'rinishini front shundan biladi) */
  async getMyToday(reqUser: any) {
    const center = await this.loadCenter(reqUser.centerId);
    const timezone = center?.timezone || DEFAULT_TIMEZONE;
    const date = dayjs().tz(timezone).format('YYYY-MM-DD');

    const attendance = await this.repo.findOne({
      where: { userId: reqUser.userId, workDate: date as any },
      relations: ['user'],
    });

    const lessons = await this.teacherLessonDays(reqUser.userId, date, date);
    const lessonsToday = await this.countLessonsOnDate(reqUser.userId, date);

    return {
      date,
      checkedIn: !!attendance,
      attendance: attendance ? this.toView(attendance) : null,
      firstLessonAt: lessons.get(date) ?? null,
      lessonsToday,
      centerConfigured: this.isCenterConfigured(center),
    };
  }

  /** Xodimning o'z tarixi (oxirgi 60 kun) */
  async getMyHistory(reqUser: any, query: QueryStaffAttendanceDto) {
    return this.findAll(
      { ...reqUser, role: UserRole.TEACHER },
      { ...query, userId: reqUser.userId },
      true,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Admin tomoni
  // ─────────────────────────────────────────────────────────────

  async findAll(
    reqUser: any,
    query: QueryStaffAttendanceDto,
    forceOwnOnly = false,
  ) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const perPage = query.perPage && query.perPage > 0 ? query.perPage : 20;

    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'user')
      .where('a."organizationId" = :organizationId', {
        organizationId: reqUser.organizationId,
      });

    const centerId = this.resolveCenterId(reqUser, query.centerId);
    if (centerId) qb.andWhere('a."centerId" = :centerId', { centerId });

    if (forceOwnOnly || query.userId) {
      qb.andWhere('a."userId" = :userId', {
        userId: forceOwnOnly ? reqUser.userId : query.userId,
      });
    }
    if (query.from) qb.andWhere('a."workDate" >= :from', { from: query.from });
    if (query.to) qb.andWhere('a."workDate" <= :to', { to: query.to });
    if (query.confidence) {
      qb.andWhere('a."confidence" = :confidence', {
        confidence: query.confidence,
      });
    }
    if (query.onlyLate) qb.andWhere('a."lateMinutes" > 0');
    if (query.onlyFlagged) {
      qb.andWhere(
        `(a."confidence" = :low OR (a."flags" IS NOT NULL AND a."flags" <> ''))`,
        { low: AttendanceConfidence.LOW },
      );
    }

    const [data, total] = await qb
      // orderBy'da qo'shtirnoq ishlatib bo'lmaydi — TypeORM uni property nomi
      // deb metadata'dan qidiradi va topa olmaydi
      .orderBy('a.workDate', 'DESC')
      .addOrderBy('a.checkInAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    return {
      data: data.map((row) => this.toView(row)),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  /**
   * Qabulxona/admin yozuvni tasdiqlaydi — "men bu odamni shu yerda ko'rdim".
   * Tasdiqlangan yozuv har doim ishonchli hisoblanadi.
   */
  async confirm(id: number, reqUser: any) {
    const row = await this.getOwnedRow(id, reqUser);

    row.confirmedByUserId = reqUser.userId;
    row.confirmedAt = new Date();
    row.confidence = AttendanceConfidence.HIGH;
    await this.repo.save(row);

    const fresh = await this.repo.findOne({
      where: { id },
      relations: ['user'],
    });
    return this.toView(fresh ?? row);
  }

  /** Admin xodim o'rniga qo'lda yozadi (telefoni o'chgan va h.k.) */
  async manualCheckIn(dto: ManualCheckInDto, reqUser: any) {
    const user = await this.userRepo.findOne({
      where: { id: dto.userId },
      relations: ['center', 'organization'],
    });
    if (!user) throw new NotFoundException('Xodim topilmadi');

    const userOrgId = (user as any).organization?.id ?? null;
    if (userOrgId !== reqUser.organizationId) {
      throw new ForbiddenException(
        'Bu xodim sizning tashkilotingizga tegishli emas',
      );
    }

    const userCenterId = (user as any).center?.id ?? null;
    const center = await this.loadCenter(userCenterId);
    const timezone = center?.timezone || DEFAULT_TIMEZONE;

    const checkInAt = dayjs.tz(
      `${dto.workDate} ${dto.checkInTime}:00`,
      timezone,
    );
    if (!checkInAt.isValid()) {
      throw new BadRequestException('Sana yoki vaqt noto‘g‘ri');
    }
    if (checkInAt.isAfter(dayjs())) {
      throw new BadRequestException('Kelajakdagi vaqtni belgilab bo‘lmaydi');
    }

    const lessons = await this.teacherLessonDays(
      dto.userId,
      dto.workDate,
      dto.workDate,
    );
    const firstLessonAt = lessons.get(dto.workDate) ?? null;
    const lateMinutes = firstLessonAt
      ? Math.max(
          0,
          checkInAt.diff(
            dayjs.tz(`${dto.workDate} ${firstLessonAt}`, timezone),
            'minute',
          ),
        )
      : 0;

    const existing = await this.repo.findOne({
      where: { userId: dto.userId, workDate: dto.workDate as any },
    });

    const row = existing ?? this.repo.create({ userId: dto.userId });
    row.centerId = userCenterId;
    row.organizationId = reqUser.organizationId;
    row.workDate = dto.workDate as any;
    row.checkInAt = checkInAt.toDate();
    row.firstLessonAt = firstLessonAt;
    row.lateMinutes = lateMinutes;
    row.source = AttendanceSource.MANUAL;
    // Qo'lda kiritilgan yozuvni admin o'z mas'uliyatiga oladi
    row.confidence = AttendanceConfidence.HIGH;
    row.confirmedByUserId = reqUser.userId;
    row.confirmedAt = new Date();
    row.note = dto.note ?? null;
    row.flags = firstLessonAt ? null : [AttendanceFlag.NO_LESSON_TODAY];

    const saved = await this.repo.save(row);
    const fresh = await this.repo.findOne({
      where: { id: saved.id },
      relations: ['user'],
    });
    return this.toView(fresh ?? saved);
  }

  async remove(id: number, reqUser: any) {
    const row = await this.getOwnedRow(id, reqUser);
    await this.repo.remove(row);
    return { success: true };
  }

  /**
   * Bitta xodimning davr bo'yicha yig'indisi (xodim sahifasi uchun).
   * `report()` dan farqi: ruxsat/filial tekshiruvi yo'q — chaqiruvchi
   * (StaffOverviewService) buni allaqachon qilgan bo'ladi.
   */
  async getUserSummary(userId: number, from: string, to: string) {
    const today = dayjs().tz(DEFAULT_TIMEZONE).format('YYYY-MM-DD');
    const effectiveTo = to > today ? today : to;

    const lessonDays =
      effectiveTo >= from
        ? await this.teacherLessonDays(userId, from, effectiveTo)
        : new Map<string, string>();

    const rows = await this.repo
      .createQueryBuilder('a')
      .where('a."userId" = :userId', { userId })
      .andWhere('a."workDate" BETWEEN :from AND :to', { from, to })
      .getMany();

    const attendedDates = new Set(
      rows.map((r) => this.formatDateOnly(r.workDate)),
    );
    let missedDays = 0;
    for (const date of lessonDays.keys()) {
      if (!attendedDates.has(date)) missedDays += 1;
    }

    const lateRows = rows.filter((r) => (r.lateMinutes ?? 0) > 0);

    return {
      expectedDays: lessonDays.size,
      attendedDays: attendedDates.size,
      missedDays,
      lateDays: lateRows.length,
      totalLateMinutes: lateRows.reduce(
        (sum, r) => sum + (r.lateMinutes ?? 0),
        0,
      ),
      flaggedDays: rows.filter(
        (r) =>
          r.confidence === AttendanceConfidence.LOW ||
          (r.flags ?? []).some(
            (f) => f && f !== AttendanceFlag.NO_LESSON_TODAY,
          ),
      ).length,
    };
  }

  /** Xodimning davr ichidagi yozuvlari (xodim sahifasidagi jadval uchun) */
  async listUserRecords(userId: number, from: string, to: string) {
    const rows = await this.repo
      .createQueryBuilder('a')
      .where('a."userId" = :userId', { userId })
      .andWhere('a."workDate" BETWEEN :from AND :to', { from, to })
      .orderBy('a.workDate', 'DESC')
      .getMany();
    return rows.map((row) => this.toView(row));
  }

  /**
   * Oylik hisobot: har bir xodim uchun kelgan kunlar, kechikish va kelmagan
   * kunlar. "Kelmagan kun" = darsi bor edi, lekin yozuv yo'q.
   */
  async report(reqUser: any, from: string, to: string, centerIdRaw?: number) {
    if (!from || !to) {
      throw new BadRequestException('from va to sanalari kerak');
    }
    if (dayjs(to).isBefore(dayjs(from))) {
      throw new BadRequestException(
        '"to" sanasi "from" dan oldin bo‘lishi mumkin emas',
      );
    }

    const centerId = this.resolveCenterId(reqUser, centerIdRaw);
    const center = centerId ? await this.loadCenter(centerId) : null;

    // 1) Doiraga kiradigan xodimlar: o'qituvchilar + shu davrda yozuvi borlar
    const teacherQb = this.userRepo
      .createQueryBuilder('user')
      .leftJoin('user.organization', 'organization')
      .leftJoin('user.center', 'center')
      .where('organization.id = :organizationId', {
        organizationId: reqUser.organizationId,
      })
      .andWhere('user.role = :role', { role: UserRole.TEACHER });
    if (centerId) teacherQb.andWhere('center.id = :centerId', { centerId });
    const teachers = await teacherQb.getMany();

    const rowsQb = this.repo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'user')
      .where('a."organizationId" = :organizationId', {
        organizationId: reqUser.organizationId,
      })
      .andWhere('a."workDate" BETWEEN :from AND :to', { from, to });
    if (centerId) rowsQb.andWhere('a."centerId" = :centerId', { centerId });
    const rows = await rowsQb.getMany();

    const users = new Map<number, User>();
    for (const t of teachers) users.set(t.id, t);
    for (const r of rows)
      if (r.user && !users.has(r.userId)) users.set(r.userId, r.user);

    // 2) Har bir xodim bo'yicha yig'amiz
    const byUser = new Map<number, StaffAttendance[]>();
    for (const r of rows) {
      const list = byUser.get(r.userId) ?? [];
      list.push(r);
      byUser.set(r.userId, list);
    }

    // Kelajakdagi darslar hali "kelmagan kun" emas — davrni bugun bilan cheklaymiz
    const today = dayjs()
      .tz(center?.timezone || DEFAULT_TIMEZONE)
      .format('YYYY-MM-DD');
    const effectiveTo = to > today ? today : to;

    const result = [];
    for (const [userId, user] of users) {
      const lessonDays =
        effectiveTo >= from
          ? await this.teacherLessonDays(userId, from, effectiveTo)
          : new Map<string, string>();
      const userRows = byUser.get(userId) ?? [];
      const attendedDates = new Set(
        userRows.map((r) => this.formatDateOnly(r.workDate)),
      );

      let missedDays = 0;
      for (const date of lessonDays.keys()) {
        if (!attendedDates.has(date)) missedDays += 1;
      }

      const lateRows = userRows.filter((r) => (r.lateMinutes ?? 0) > 0);
      const flaggedDays = userRows.filter(
        (r) =>
          r.confidence === AttendanceConfidence.LOW ||
          (r.flags ?? []).some(
            (f) => f && f !== AttendanceFlag.NO_LESSON_TODAY,
          ),
      ).length;

      result.push({
        user: this.userView(user),
        expectedDays: lessonDays.size,
        attendedDays: attendedDates.size,
        missedDays,
        lateDays: lateRows.length,
        totalLateMinutes: lateRows.reduce(
          (s, r) => s + (r.lateMinutes ?? 0),
          0,
        ),
        flaggedDays,
      });
    }

    result.sort(
      (a, b) =>
        b.totalLateMinutes - a.totalLateMinutes || b.missedDays - a.missedDays,
    );

    return {
      from,
      to,
      centerNotConfigured: center ? !this.isCenterConfigured(center) : false,
      rows: result,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Dalillarni baholash
  // ─────────────────────────────────────────────────────────────

  /**
   * GPS + IP + qurilma bo'yicha yozuvga qanchalik ishonish mumkinligini
   * aniqlaydi. Markaz sozlanmagan bo'lsa hech narsa "yolg'on" deb
   * belgilanmaydi — shunchaki tekshirib bo'lmagani aytiladi.
   */
  private async evaluateEvidence(
    userId: number,
    center: Center | null,
    dto: CheckInDto,
    req: any,
  ) {
    const flags: AttendanceFlag[] = [];

    // ── GPS ──
    const centerLat = center?.latitude != null ? Number(center.latitude) : null;
    const centerLng =
      center?.longitude != null ? Number(center.longitude) : null;
    const hasCenterGeo = centerLat != null && centerLng != null;

    let distanceMeters: number | null = null;
    let geoMatched: boolean | null = null;

    if (dto.latitude == null || dto.longitude == null) {
      flags.push(AttendanceFlag.NO_GEO);
    } else if (hasCenterGeo) {
      distanceMeters = distanceInMeters(
        Number(dto.latitude),
        Number(dto.longitude),
        centerLat as number,
        centerLng as number,
      );
      const radius = Number(center?.checkInRadiusMeters ?? 150);
      const accuracy = Number(dto.accuracyMeters ?? 0);

      if (accuracy > MAX_TRUSTED_ACCURACY_METERS) {
        // GPS o'zi ham "qayerdaligimni bilmayman" deyapti — ayblab bo'lmaydi
        flags.push(AttendanceFlag.LOW_GPS_ACCURACY);
        geoMatched = null;
      } else {
        // Brauzer bergan xatolik radiusini foydasiga hisoblaymiz
        geoMatched = distanceMeters - Math.min(accuracy, 100) <= radius;
        if (!geoMatched) flags.push(AttendanceFlag.FAR_FROM_CENTER);
      }
    }

    // ── Markaz Wi-Fi'si (public IP) ──
    const ip = getClientIp(req);
    let ipMatched: boolean | null = null;
    if (center?.publicIp) {
      ipMatched = !!ip && ip === center.publicIp;
      if (!ipMatched) flags.push(AttendanceFlag.IP_MISMATCH);
    }

    if (!hasCenterGeo && !center?.publicIp) {
      flags.push(AttendanceFlag.CENTER_NOT_CONFIGURED);
    }

    // ── Qurilma boshqa xodimnikimi ──
    if (dto.deviceId) {
      const since = dayjs()
        .subtract(SHARED_DEVICE_LOOKBACK_DAYS, 'day')
        .format('YYYY-MM-DD');
      const shared = await this.repo
        .createQueryBuilder('a')
        .where('a."deviceId" = :deviceId', { deviceId: dto.deviceId })
        .andWhere('a."userId" <> :userId', { userId })
        .andWhere('a."workDate" >= :since', { since })
        .getCount();
      if (shared > 0) flags.push(AttendanceFlag.SHARED_DEVICE);
    }

    return {
      flags,
      distanceMeters,
      geoMatched,
      ip,
      ipMatched,
      confidence: this.computeConfidence(geoMatched, ipMatched, flags),
    };
  }

  /**
   * high  — ikkala langar ham mos (yoki bittasi mos, ikkinchisi sozlanmagan)
   * medium — bittasi mos, ikkinchisi mos emas / noma'lum
   * low   — mos kelgan langar yo'q
   */
  private computeConfidence(
    geoMatched: boolean | null,
    ipMatched: boolean | null,
    flags: AttendanceFlag[],
  ): AttendanceConfidence {
    const signals = [geoMatched, ipMatched];
    const matched = signals.filter((s) => s === true).length;
    const failed = signals.filter((s) => s === false).length;

    let confidence: AttendanceConfidence;
    if (matched >= 2) {
      confidence = AttendanceConfidence.HIGH;
    } else if (matched === 1) {
      confidence =
        failed > 0 ? AttendanceConfidence.MEDIUM : AttendanceConfidence.HIGH;
    } else if (failed > 0) {
      confidence = AttendanceConfidence.LOW;
    } else {
      // Hech narsa tekshirilmagan: markaz sozlanmagan bo'lsa aybi xodimda emas
      confidence = flags.includes(AttendanceFlag.CENTER_NOT_CONFIGURED)
        ? AttendanceConfidence.MEDIUM
        : AttendanceConfidence.LOW;
    }

    // Bitta telefondan bir necha xodim kirishi — eng kuchli firibgarlik belgisi.
    // Langarlar mos kelsa ham bu yozuvni "ishonchli" deb ayta olmaymiz.
    if (
      flags.includes(AttendanceFlag.SHARED_DEVICE) &&
      confidence === AttendanceConfidence.HIGH
    ) {
      return AttendanceConfidence.MEDIUM;
    }

    return confidence;
  }

  // ─────────────────────────────────────────────────────────────
  // Dars kunlari
  // ─────────────────────────────────────────────────────────────

  /**
   * O'qituvchining [from..to] oralig'idagi dars kunlari va o'sha kundagi eng
   * erta dars vaqti. Ko'chirilgan darslar (`AttendanceLessonOverride`)
   * hisobga olinadi.
   */
  private async teacherLessonDays(
    teacherId: number,
    from: string,
    to: string,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    const groups = await this.groupRepo.find({
      where: { teacher: { id: teacherId } },
      relations: ['schedules'],
    });
    if (!groups.length) return result;

    const overrides = await this.overrideRepo.find({
      where: { groupId: In(groups.map((g) => g.id)) },
    });

    for (const group of groups) {
      for (const lesson of this.groupLessonDays(group, overrides, from, to)) {
        const prev = result.get(lesson.date);
        if (!prev || lesson.startTime < prev) {
          result.set(lesson.date, lesson.startTime);
        }
      }
    }

    return result;
  }

  private groupLessonDays(
    group: Group,
    allOverrides: AttendanceLessonOverride[],
    from: string,
    to: string,
  ): LessonDay[] {
    const timezone = group.timezone || DEFAULT_TIMEZONE;
    const schedules = group.schedules ?? [];
    if (!schedules.length) return [];

    const startDate = dayjs(group.startDate).format('YYYY-MM-DD');
    const endDate = group.endDate
      ? dayjs(group.endDate).format('YYYY-MM-DD')
      : null;

    const scheduled = computeLessonDates({
      timezone,
      groupStartDate: startDate,
      groupEndDate: endDate,
      schedules,
      window: { mode: 'range', from, to },
    });

    const byDate = new Map<string, string>();
    for (const date of scheduled) {
      const time = this.earliestTimeForDate(group, date, timezone);
      if (time) byDate.set(date, time);
    }

    // Ko'chirilgan darslar: eski kundan olib tashlanadi, yangi kunga qo'shiladi
    for (const o of allOverrides) {
      if (o.groupId !== group.id) continue;
      const fromDate = this.formatDateOnly(o.fromDate);
      const toDate = this.formatDateOnly(o.toDate);

      const movedTime =
        byDate.get(fromDate) ??
        this.earliestTimeForDate(group, fromDate, timezone);
      byDate.delete(fromDate);

      if (toDate >= from && toDate <= to && movedTime) {
        const existing = byDate.get(toDate);
        if (!existing || movedTime < existing) byDate.set(toDate, movedTime);
      }
    }

    return Array.from(byDate.entries()).map(([date, startTime]) => ({
      date,
      startTime,
    }));
  }

  /** Shu sanadagi (hafta kuniga mos) eng erta dars vaqti */
  private earliestTimeForDate(
    group: Group,
    date: string,
    timezone: string,
  ): string | null {
    const dow = dayjs.tz(date, timezone).day();
    const times = (group.schedules ?? [])
      .filter((s) => weekDayToDow[s.day] === dow)
      .map((s) => s.startTime)
      .sort();
    return times[0] ?? null;
  }

  /** Bugun nechta dars bor (UI'da ko'rsatish uchun) */
  private async countLessonsOnDate(
    teacherId: number,
    date: string,
  ): Promise<number> {
    const groups = await this.groupRepo.find({
      where: { teacher: { id: teacherId } },
      relations: ['schedules'],
    });
    if (!groups.length) return 0;

    const overrides = await this.overrideRepo.find({
      where: { groupId: In(groups.map((g) => g.id)) },
    });

    let count = 0;
    for (const group of groups) {
      count += this.groupLessonDays(group, overrides, date, date).length;
    }
    return count;
  }

  // ─────────────────────────────────────────────────────────────
  // Yordamchilar
  // ─────────────────────────────────────────────────────────────

  private async loadCenter(centerId?: number | null): Promise<Center | null> {
    if (!centerId) return null;
    return this.centerRepo.findOne({ where: { id: centerId } });
  }

  private isCenterConfigured(center: Center | null): boolean {
    if (!center) return false;
    const hasGeo = center.latitude != null && center.longitude != null;
    return hasGeo || !!center.publicIp;
  }

  /** Admin filial tanlashi mumkin, qolganlar o'z filialida qamalgan */
  private resolveCenterId(
    reqUser: any,
    requested?: number,
  ): number | undefined {
    const isAdmin =
      reqUser.role === UserRole.ADMIN || reqUser.role === UserRole.SUPER_ADMIN;
    if (isAdmin) return requested ? +requested : undefined;
    return reqUser.centerId ?? undefined;
  }

  private async getOwnedRow(
    id: number,
    reqUser: any,
  ): Promise<StaffAttendance> {
    const row = await this.repo.findOne({ where: { id }, relations: ['user'] });
    if (!row) throw new NotFoundException('Davomat yozuvi topilmadi');
    if (row.organizationId !== reqUser.organizationId) {
      throw new ForbiddenException('Bu yozuvga ruxsatingiz yo‘q');
    }
    const centerId = this.resolveCenterId(reqUser, undefined);
    if (centerId && row.centerId !== centerId) {
      throw new ForbiddenException('Bu yozuv boshqa filialga tegishli');
    }
    return row;
  }

  private formatDateOnly(value: Date | string): string {
    return dayjs(value).format('YYYY-MM-DD');
  }

  private userView(user?: User | null) {
    if (!user) return null;
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    };
  }

  private toView(row: StaffAttendance) {
    return {
      id: row.id,
      user: this.userView(row.user),
      userId: row.userId,
      centerId: row.centerId,
      workDate: this.formatDateOnly(row.workDate),
      checkInAt: row.checkInAt,
      firstLessonAt: row.firstLessonAt,
      lateMinutes: row.lateMinutes ?? 0,
      source: row.source,
      confidence: row.confidence,
      distanceMeters: row.distanceMeters,
      geoMatched: row.geoMatched,
      ipMatched: row.ipMatched,
      // simple-array bo'sh satrni [''] qilib qaytarishi mumkin
      flags: (row.flags ?? []).filter(Boolean),
      confirmedByUserId: row.confirmedByUserId,
      confirmedAt: row.confirmedAt,
      note: row.note,
    };
  }
}
