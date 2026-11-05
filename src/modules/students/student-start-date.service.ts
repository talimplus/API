import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { StudentStatus } from '@/common/enums/students-status.enums';
import {
  EnrollmentsService,
  toDateOnly,
} from '@/modules/enrollments/enrollments.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { BackdateSimulation } from '@/modules/payments/backdate-preview.interface';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { dayjs } from '@/shared/utils/dayjs';
import { assertNotBeforeOrganization } from '@/modules/organizations/organization-opened.util';

/**
 * O'quvchining o'qishni boshlagan sanasini orqaga qo'yish — ikki holat:
 *
 * 1. **Birinchi faollashtirish** (`new/ignored → active`, `startDate`):
 *    `activatedAt` shu sanaga, har bir guruhdagi ochiq a'zolik
 *    `max(sana, guruh startDate)` ga suriladi.
 * 2. **Tahrirda yangi guruh qo'shish** (`groupJoinedAt`): faqat yangi
 *    guruhlarning a'zoligi shu sanadan ochiladi; sana guruh boshlanishidan
 *    oldin bo'lolmaydi. Faol o'quvchining `activatedAt` i keyinroq bo'lsa
 *    u ham suriladi (aks holda to'lov baribir `activatedAt` dan boshlanardi).
 *
 * Har ikkalasida o'sha oydan bugungacha to'lov qatorlari yaratiladi va
 * qayta hisoblanadi (`rebillAfterBackdating`).
 */
@Injectable()
export class StudentStartDateService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly enrollments: EnrollmentsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  private tz(group?: Group | null) {
    return group?.timezone || 'Asia/Tashkent';
  }

  /**
   * Sana bugundan keyin, 24 oydan uzoq orqada va tashkilot ochilgan kundan
   * oldin bo'lolmaydi.
   */
  async assertDate(
    date: string,
    field: string,
    centerId: number | null | undefined,
    group?: Group | null,
  ) {
    const today = dayjs().tz(this.tz(group)).format('YYYY-MM-DD');
    if (date > today) {
      throw new ValidationException({
        [field]: "Sana bugundan keyin bo'lishi mumkin emas",
      });
    }
    const minDate = dayjs(today)
      .subtract(23, 'month')
      .startOf('month')
      .format('YYYY-MM-DD');
    if (date < minDate) {
      throw new ValidationException({
        [field]: `Sana ${minDate} dan oldin bo'lishi mumkin emas`,
      });
    }
    await assertNotBeforeOrganization(
      this.studentRepo,
      centerId,
      date,
      field,
      this.tz(group),
    );
  }

  /** Qo'shilgan sana har bir yangi guruh boshlanishidan oldin bo'lolmaydi. */
  async assertJoinDate(
    date: string,
    groups: Group[],
    centerId: number | null | undefined,
  ) {
    await this.assertDate(date, 'groupJoinedAt', centerId, groups[0]);
    for (const g of groups) {
      const start = toDateOnly(g.startDate);
      if (start && date < start) {
        throw new ValidationException({
          groupJoinedAt: `"${g.name}" guruhi ${start} da boshlangan — qo'shilgan sana undan oldin bo'lolmaydi`,
        });
      }
    }
  }

  /** Guruh uchun haqiqiy a'zolik boshlanishi: guruh boshlanishidan oldin emas. */
  private joinDateFor(group: Group, date: string) {
    const start = toDateOnly(group.startDate);
    return start && start > date ? start : date;
  }

  private startOfDay(date: string, group?: Group | null): Date {
    return dayjs.tz(date, this.tz(group)).toDate();
  }

  private activatedAfter(student: Student, date: string, group?: Group | null) {
    if (!student.activatedAt) return true;
    return (
      dayjs(student.activatedAt).tz(this.tz(group)).format('YYYY-MM-DD') > date
    );
  }

  /**
   * Ta'sirni hisoblaydi (hech narsa yozmaydi).
   * `groupIds` berilsa — tahrirda qo'shilayotgan yangi guruhlar; berilmasa —
   * birinchi faollashtirish (o'quvchining hozirgi barcha guruhlari).
   */
  async preview(studentId: number, date: string, groupIds?: number[]) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId },
      relations: ['groups'],
    });
    if (!student) return null;

    const ids = groupIds ?? (student.groups ?? []).map((g) => g.id);
    const groups = ids.length
      ? await this.groupRepo.find({
          where: { id: In(ids) },
          relations: ['schedules'],
        })
      : [];

    const activating = !groupIds;
    const copy = { ...student } as Student;
    if (activating) copy.status = StudentStatus.ACTIVE;
    if (
      (activating || student.status === StudentStatus.ACTIVE) &&
      this.activatedAfter(student, date, groups[0])
    ) {
      copy.activatedAt = this.startOfDay(date, groups[0]);
    }

    const sims: BackdateSimulation[] = [];
    for (const group of groups) {
      const joinedAt = this.joinDateFor(group, date);
      const existing = await this.enrollments.getWindows(studentId, group.id);
      const hasOpen = existing.some((w) => !w.leftAt);
      const windows = hasOpen
        ? existing.map((w) =>
            !w.leftAt && w.joinedAt > joinedAt ? { ...w, joinedAt } : w,
          )
        : [...existing, { joinedAt, leftAt: null }];
      sims.push({
        student: copy,
        group,
        windows,
        fromMonth: dayjs(date).startOf('month').format('YYYY-MM-01'),
      });
    }

    const result = await this.paymentsService.previewBackdating(sims);
    this.enrollments.clearCache();
    return { startDate: date, ...result };
  }

  /**
   * Birinchi faollashtirishdan keyin: a'zoliklar suriladi, to'lovlar
   * sanadan bugungacha yaratiladi. `activatedAt` ni chaqiruvchi qo'yadi.
   */
  async applyActivation(student: Student, date: string) {
    const groups = student.groups ?? [];
    for (const g of groups) {
      await this.enrollments.open(student.id, g.id, this.joinDateFor(g, date));
    }
    await this.paymentsService.rebillAfterBackdating({
      studentIds: [student.id],
      groupIds: groups.map((g) => g.id),
      fromDate: date,
    });
  }

  /** Yangi guruhlarga qo'shilgan sana: a'zolik suriladi va qayta hisoblanadi. */
  async applyJoin(student: Student, groups: Group[], date: string) {
    if (!groups.length) return;
    for (const g of groups) {
      await this.enrollments.open(student.id, g.id, date);
    }
    if (
      student.status === StudentStatus.ACTIVE &&
      this.activatedAfter(student, date, groups[0])
    ) {
      await this.studentRepo.update(student.id, {
        activatedAt: this.startOfDay(date, groups[0]),
      });
    }
    await this.paymentsService.rebillAfterBackdating({
      studentIds: [student.id],
      groupIds: groups.map((g) => g.id),
      fromDate: date,
    });
  }

  /**
   * O'qishni to'xtatgan kun (`stopDate`, exclusive): bugundan keyin, tashkilot
   * ochilishidan, faollashgan kundan va ochiq a'zoliklar boshlanishidan oldin
   * bo'lolmaydi. Shu kundan keyin "keldi"/"kechikdi" belgisi bo'lsa — o'quvchi
   * o'qigan, to'xtatish sanasi noto'g'ri (422 `stopDate`).
   */
  async assertStopDate(student: Student, date: string, group?: Group | null) {
    await this.assertDate(date, 'stopDate', student.centerId, group);
    if (student.activatedAt) {
      const activated = dayjs(student.activatedAt)
        .tz(this.tz(group))
        .format('YYYY-MM-DD');
      if (date < activated) {
        throw new ValidationException({
          stopDate: `O'quvchi ${activated} da faollashgan — to'xtatish sanasi undan oldin bo'lolmaydi`,
        });
      }
    }
    const [joined] = await this.studentRepo.query(
      `SELECT MAX("joinedAt") AS "joinedAt" FROM "student_group_enrollments"
        WHERE "studentId" = $1 AND "leftAt" IS NULL`,
      [student.id],
    );
    const lastJoin = toDateOnly(joined?.joinedAt);
    if (lastJoin && date < lastJoin) {
      throw new ValidationException({
        stopDate: `O'quvchi ${lastJoin} da guruhga qo'shilgan — to'xtatish sanasi undan oldin bo'lolmaydi`,
      });
    }
    const [att] = await this.studentRepo.query(
      `SELECT COUNT(*)::int AS "count", MAX("lessonDate") AS "last" FROM "attendance"
        WHERE "studentId" = $1 AND "lessonDate" >= $2::date
          AND "status" IN ('present', 'late')`,
      [student.id, date],
    );
    if (Number(att?.count ?? 0) > 0) {
      throw new ValidationException({
        stopDate: `${date} dan keyin ${att.count} ta darsga "keldi" deb belgilangan (oxirgisi ${toDateOnly(att.last)}) — to'xtatish sanasi undan keyin bo'lishi kerak`,
      });
    }
  }

  /**
   * Bitta guruhdan chiqish kuni (`stopDate`, exclusive). `assertStopDate` dan
   * farqi: a'zolik va davomat faqat SHU guruh bo'yicha tekshiriladi — boshqa
   * guruhlarda o'qishi davom etadi. Bugun chiqsa ham davomat tekshiriladi:
   * bugun kelgan bo'lsa, bu dars bepul qolib ketmasligi kerak.
   */
  async assertGroupLeaveDate(
    student: Student,
    group: Group,
    date: string,
    today: string,
  ) {
    if (date !== today) {
      await this.assertDate(date, 'stopDate', student.centerId, group);
      if (student.activatedAt) {
        const activated = dayjs(student.activatedAt)
          .tz(this.tz(group))
          .format('YYYY-MM-DD');
        if (date < activated) {
          throw new ValidationException({
            stopDate: `O'quvchi ${activated} da faollashgan — sana undan oldin bo'lolmaydi`,
          });
        }
      }
      const open = (
        await this.enrollments.getWindows(student.id, group.id)
      ).find((w) => !w.leftAt);
      if (open && date < open.joinedAt) {
        throw new ValidationException({
          stopDate: `O'quvchi bu guruhga ${open.joinedAt} da qo'shilgan — sana undan oldin bo'lolmaydi`,
        });
      }
    }
    const [att] = await this.studentRepo.query(
      `SELECT COUNT(*)::int AS "count", MAX("lessonDate") AS "last" FROM "attendance"
        WHERE "studentId" = $1 AND "groupId" = $2 AND "lessonDate" >= $3::date
          AND "status" IN ('present', 'late')`,
      [student.id, group.id, date],
    );
    if (Number(att?.count ?? 0) > 0) {
      const last = toDateOnly(att.last) as string;
      throw new ValidationException({
        stopDate:
          date === today && last === today
            ? 'Bugungi darsga "keldi" deb belgilangan — bu dars puli olinishi uchun o\'quvchini ertaga chiqaring'
            : `${date} dan boshlab bu guruhda ${att.count} ta darsga "keldi" deb belgilangan (oxirgisi ${last}) — sana undan keyin bo'lishi kerak`,
      });
    }
  }

  /** Tashqaridan (changeStatus) `activatedAt` qiymatini hisoblash uchun. */
  activatedAtFor(date: string, group?: Group | null): Date {
    return this.startOfDay(date, group);
  }
}
