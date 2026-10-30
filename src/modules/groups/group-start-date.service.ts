import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { StudentStatus } from '@/common/enums/students-status.enums';
import {
  EnrollmentsService,
  EnrollmentWindow,
  toDateOnly,
} from '@/modules/enrollments/enrollments.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { BackdateSimulation } from '@/modules/payments/backdate-preview.interface';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { dayjs } from '@/shared/utils/dayjs';
import { assertNotBeforeOrganization } from '@/modules/organizations/organization-opened.util';

/** Guruh boshlanishi bilan birga a'zoligi suriladigan o'quvchi. */
export interface BackdateCandidate {
  studentId: number;
  fullName: string;
  status: StudentStatus;
  /** Hozirgi a'zolik sanasi (yangi startDate dan keyin). */
  joinedAt: string;
}

/**
 * Guruh boshlanish sanasini (`startDate`) o'zgartirish — ayniqsa o'tgan
 * sanaga ("darslar 5 kun oldin boshlangan, sistemaga endi kiritdik").
 *
 * To'lov guruh statusiga emas, sanalarga qaraydi:
 * `billable = [group.startDate..endDate] ∩ a'zolik oynasi ∩ activatedAt dan`.
 * Shuning uchun faqat `startDate` ni surish yetmaydi — guruh hali sistemada
 * bo'lmagan paytda qo'shilgan o'quvchilarning a'zolik sanasi ham surilishi
 * kerak. Qaysi o'quvchilar surilishini foydalanuvchi tanlaydi
 * (`backdateStudentIds`); boshqa guruhdan ko'chirilganlar hech qachon
 * surilmaydi (ularning sanasi ko'chirishda aniq berilgan).
 */
@Injectable()
export class GroupStartDateService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly enrollments: EnrollmentsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  private today(group: Group): string {
    return dayjs()
      .tz(group.timezone || 'Asia/Tashkent')
      .format('YYYY-MM-DD');
  }

  /**
   * Yangi boshlanish sanasini tekshiradi (saqlashdan OLDIN):
   * - tugash sanasidan keyin bo'lolmaydi;
   * - 24 oydan uzoq orqaga ketolmaydi (to'lov oynasi chegarasi);
   * - tashkilot ochilgan kundan oldin bo'lolmaydi;
   * - undan oldingi kunlarga davomat yozilgan bo'lsa — sanani oldinga
   *   surib bo'lmaydi (davomat jurnaldan yo'qolib, to'lov kamayib ketardi).
   */
  async assertStartDate(group: Group, next: string) {
    const endDate = toDateOnly(group.endDate);
    if (endDate && next > endDate) {
      throw new ValidationException({
        startDate: `Boshlanish sanasi tugash sanasidan (${endDate}) keyin bo'lishi mumkin emas`,
      });
    }
    const minDate = dayjs(this.today(group))
      .subtract(23, 'month')
      .startOf('month')
      .format('YYYY-MM-DD');
    if (next < minDate) {
      throw new ValidationException({
        startDate: `Boshlanish sanasi ${minDate} dan oldin bo'lishi mumkin emas`,
      });
    }
    await assertNotBeforeOrganization(
      this.studentRepo,
      group.center?.id,
      next,
      'startDate',
      group.timezone,
    );
    const attendanceBefore = await this.countAttendanceBefore(group.id, next);
    if (attendanceBefore > 0) {
      throw new ValidationException({
        startDate: `${next} dan oldingi darslarga davomat yozilgan (${attendanceBefore} ta) — avval davomatni o'chiring`,
      });
    }
  }

  private async countAttendanceBefore(groupId: number, date: string) {
    const [row] = await this.studentRepo.query(
      `SELECT COUNT(*)::int AS "count" FROM "attendance"
        WHERE "groupId" = $1 AND "lessonDate" < $2::date`,
      [groupId, date],
    );
    return Number(row?.count ?? 0);
  }

  /** A'zoligi `date` ga surilishi mumkin bo'lgan o'quvchilar. */
  async candidates(group: Group, date: string): Promise<BackdateCandidate[]> {
    const rows = await this.enrollments.findBackdatableForGroup(group.id, date);
    if (!rows.length) return [];
    const students = await this.studentRepo.find({
      where: { id: In(rows.map((r) => r.studentId)) },
    });
    const byId = new Map(students.map((s) => [s.id, s]));
    return rows
      .filter((r) => byId.has(r.studentId))
      .map((r) => {
        const s = byId.get(r.studentId)!;
        return {
          studentId: r.studentId,
          fullName: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim(),
          status: s.status,
          joinedAt: r.joinedAt,
        };
      });
  }

  /** Tanlanganlarni nomzodlar bilan kesishtiradi (`undefined` — hammasi). */
  private pick(candidates: BackdateCandidate[], ids?: number[]) {
    if (!ids) return candidates;
    const set = new Set(ids);
    return candidates.filter((c) => set.has(c.studentId));
  }

  /** Guruhda biror marta a'zo bo'lgan barcha o'quvchilar. */
  private async memberIds(groupId: number): Promise<number[]> {
    const rows: { studentId: number }[] = await this.studentRepo.query(
      `SELECT DISTINCT "studentId" FROM "student_group_enrollments"
        WHERE "groupId" = $1`,
      [groupId],
    );
    return rows.map((r) => Number(r.studentId));
  }

  /** `activatedAt` ni sananing guruh timezone'idagi boshiga keltiradi. */
  private startOfDay(group: Group, date: string): Date {
    return dayjs.tz(date, group.timezone || 'Asia/Tashkent').toDate();
  }

  private activatedAfter(student: Student, group: Group, date: string) {
    if (!student.activatedAt) return false;
    const activated = dayjs(student.activatedAt)
      .tz(group.timezone || 'Asia/Tashkent')
      .format('YYYY-MM-DD');
    return activated > date;
  }

  /**
   * Sana o'zgarishi ta'sir qiladigan eng kech kun: eski/yangi boshlanish va
   * surilayotgan o'quvchilarning eski `joinedAt` i. Undan keyingi oylar
   * proratsiyasi o'zgarmaydi — preview ham, qayta hisoblash ham shu oygacha.
   */
  private latestAffected(
    prev: string,
    next: string,
    selected: BackdateCandidate[],
  ): string {
    let latest = prev > next ? prev : next;
    for (const c of selected) if (c.joinedAt > latest) latest = c.joinedAt;
    return latest;
  }

  /**
   * Sana o'zgarishi to'lovlarga qanday ta'sir qilishini hisoblaydi (hech
   * narsa yozmaydi). `group` — `schedules` bilan yuklangan.
   */
  async preview(group: Group, next: string, backdateStudentIds?: number[]) {
    const prev = toDateOnly(group.startDate) ?? next;
    const candidates = await this.candidates(group, next);
    const selected = this.pick(candidates, backdateStudentIds);
    const selectedIds = new Set(selected.map((c) => c.studentId));

    const groupCopy = { ...group, startDate: next } as unknown as Group;
    const fromMonth = dayjs(prev < next ? prev : next)
      .startOf('month')
      .format('YYYY-MM-01');
    // `apply` bilan bir xil oraliq — preview qo'llanmaydigan oyni ko'rsatmasin.
    const toMonth = dayjs(this.latestAffected(prev, next, selected))
      .startOf('month')
      .format('YYYY-MM-01');

    const memberIds = await this.memberIds(group.id);
    const students = memberIds.length
      ? await this.studentRepo.find({ where: { id: In(memberIds) } })
      : [];

    const sims: BackdateSimulation[] = [];
    for (const student of students) {
      let windows: EnrollmentWindow[] | undefined;
      let studentCopy = student;
      if (selectedIds.has(student.id)) {
        windows = (await this.enrollments.getWindows(student.id, group.id)).map(
          (w) => (w.leftAt ? w : { ...w, joinedAt: next }),
        );
        if (this.activatedAfter(student, group, next)) {
          studentCopy = {
            ...student,
            activatedAt: this.startOfDay(group, next),
          } as Student;
        }
      }
      sims.push({
        student: studentCopy,
        group: groupCopy,
        windows,
        fromMonth,
        toMonth,
      });
    }

    const result = await this.paymentsService.previewBackdating(sims);
    this.enrollments.clearCache();
    return {
      startDate: next,
      prevStartDate: prev,
      attendanceBefore: await this.countAttendanceBefore(group.id, next),
      candidates,
      ...result,
    };
  }

  /**
   * Sana SAQLANGANDAN keyin: tanlangan o'quvchilarning a'zoligi (va kerak
   * bo'lsa `activatedAt`) yangi sanaga suriladi, ta'sirlangan oylar qayta
   * hisoblanadi. `candidates` — saqlashdan OLDIN olingan ro'yxat.
   */
  async apply(args: {
    group: Group;
    prev: string;
    next: string;
    candidates: BackdateCandidate[];
    backdateStudentIds?: number[];
  }) {
    const { group, prev, next } = args;
    const selected = this.pick(args.candidates, args.backdateStudentIds);
    if (prev === next && !selected.length) return;

    const latest = this.latestAffected(prev, next, selected);
    for (const c of selected) {
      await this.enrollments.open(c.studentId, group.id, next);
    }
    if (selected.length) {
      const students = await this.studentRepo.find({
        where: { id: In(selected.map((c) => c.studentId)) },
      });
      for (const s of students) {
        if (
          s.status === StudentStatus.ACTIVE &&
          this.activatedAfter(s, group, next)
        ) {
          await this.studentRepo.update(s.id, {
            activatedAt: this.startOfDay(group, next),
          });
        }
      }
    }

    await this.paymentsService.rebillAfterBackdating({
      studentIds: await this.memberIds(group.id),
      groupIds: [group.id],
      fromDate: prev < next ? prev : next,
      toMonth: dayjs(latest).startOf('month').format('YYYY-MM-01'),
    });
  }
}
