import { Attendance } from '@/modules/attendance/entities/attendance.entity';
import { AttendanceStatus } from '@/modules/attendance/enums/attendance-status.enum';
import { GetLessonDatesQueryDto } from '@/modules/attendance/dto/get-lesson-dates.query.dto';
import { SubmitAttendanceDto } from '@/modules/attendance/dto/submit-attendance.dto';
import { computeLessonDates } from '@/modules/attendance/utils/lesson-dates';
import { Group } from '@/modules/groups/entities/groups.entity';
import { dayjs } from '@/shared/utils/dayjs';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { UserRole } from '@/common/enums/user-role.enums';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,

    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
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
      if (!group.teacher?.id || group.teacher.id !== user.id) {
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

    const lessonDates = this.computeLessonDatesForGroup(group, query);
    if (!lessonDates.length) {
      return { timezone, today, lessonDates: [], attendanceByDate: {} };
    }

    const rows = await this.attendanceRepo.find({
      where: {
        groupId,
        lessonDate: In(lessonDates as any),
      },
      relations: ['student'],
      order: { lessonDate: 'ASC', studentId: 'ASC' },
    });

    const byDate: Record<string, any> = {};
    for (const d of lessonDates) {
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

    return { timezone, today, lessonDates, attendanceByDate: byDate };
  }

  async submitAttendance(groupId: number, dto: SubmitAttendanceDto, user: any) {
    const group = await this.getGroupOrThrow(groupId);
    this.assertCanAccessGroup(user, group);

    if (!group.schedules?.length) {
      throw new BadRequestException('Group schedule is not configured');
    }

    const timezone = group.timezone || 'Asia/Tashkent';
    const today = this.getTodayInGroupTz(timezone);

    const isAdmin = this.isAdminRole(user.role);
    const isTeacher = user.role === UserRole.TEACHER;

    // Teacher can submit only for today (group TZ). Admin can override past.
    if (isTeacher && dto.lessonDate !== today) {
      throw new ForbiddenException('Teachers can submit only for today');
    }
    if (!isAdmin && !isTeacher) {
      throw new ForbiddenException('Not allowed');
    }
    // Disallow future submissions for now (keeps "no invented future facts")
    if (dayjs.tz(dto.lessonDate, timezone).isAfter(dayjs.tz(today, timezone))) {
      throw new ForbiddenException('Cannot submit for future dates');
    }

    // Validate lessonDate is a real lesson date (schedule + boundaries only)
    const groupStartDate = dayjs(group.startDate).format('YYYY-MM-DD');
    const groupEndDate = group.endDate
      ? dayjs(group.endDate).format('YYYY-MM-DD')
      : null;
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

    const now = new Date();
    const upsertRows = dto.items.map((i) => ({
      groupId,
      studentId: i.studentId,
      lessonDate: dto.lessonDate as any,
      status: i.status ?? AttendanceStatus.PRESENT,
      comment: i.comment ?? null,
      submittedById: user.id,
      submittedAt: now,
      updatedAt: now,
    }));

    await this.attendanceRepo.upsert(upsertRows, [
      'groupId',
      'studentId',
      'lessonDate',
    ]);

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
}
