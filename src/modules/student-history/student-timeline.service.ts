import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { RolesService } from '@/modules/roles/roles.service';
import { CurrentUser } from '@/common/types/current.user';
import {
  StudentEventType,
  StudentTimelineCategory as Cat,
  StudentTimelineType as T,
} from '@/modules/student-history/student-timeline.enums';

export interface TimelineRef {
  id: number;
  name: string;
}

export interface StudentTimelineItem {
  /** Manba + id (`receipt:12`), front uchun barqaror kalit. */
  id: string;
  type: T;
  category: Cat;
  /** ISO vaqt; `dateOnly` bo'lsa — `YYYY-MM-DD` (vaqti noma'lum). */
  occurredAt: string;
  dateOnly: boolean;
  actor: TimelineRef | null;
  group: TimelineRef | null;
  details: Record<string, unknown>;
}

/** Sana-only voqealar shu timezone'dagi kun boshi deb tartiblanadi. */
const TZ = 'Asia/Tashkent';
/** `changeStatus` STOPPED da a'zolik oynalarini shu sabab bilan yopadi. */
const STOP_REASON = "O'quvchi to'xtatildi";

interface Row {
  [key: string]: any;
}

interface Draft extends StudentTimelineItem {
  sortAt: number;
}

/**
 * O'quvchi tarixi (timeline).
 *
 * Ikki manba birlashtiriladi:
 *  1. **Mavjud jadvallar** — a'zolik oynalari, cheklar, qaytarilgan pul,
 *     chegirmalar, shaxsiy narx tarixi, tavsiya, Telegram, davomat. Bular
 *     funksiya qo'shilishidan oldingi tarixni ham ko'rsatadi.
 *  2. **`student_events` jurnali** — boshqa joyda izi qolmaydigan amallar
 *     (holat o'zgarishi, tahrir, ko'chirish muallifi, qo'lda chiqarilgan summa).
 *
 * Bir voqea ikkala manbada bo'lsa (masalan ko'chirish), jurnaldagisi olinadi —
 * unda muallif va summalar bor. To'lov voqealari `payments.view`, davomat
 * `attendance.view` ruxsati bo'lganda qaytariladi.
 */
@Injectable()
export class StudentTimelineService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rolesService: RolesService,
  ) {}

  async getTimeline(
    user: CurrentUser,
    studentId: number,
  ): Promise<{ items: StudentTimelineItem[] }> {
    const [student] = await this.q(
      `SELECT s.id, s.status, s."createdAt", s."activatedAt", s."stoppedAt"
         FROM students s
         JOIN centers c ON c.id = s."centerId"
        WHERE s.id = $1 AND c."organizationId" = $2`,
      [studentId, user.organizationId],
    );
    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);

    const [canPayments, canAttendance] = await Promise.all([
      this.rolesService.userHasPermission(user, ['payments.view']),
      this.rolesService.userHasPermission(user, ['attendance.view']),
    ]);

    const logged = await this.loggedEvents(studentId);
    const statusEvents = logged.filter(
      (e) => e.type === T.STATUS_CHANGED && e.details.derived !== true,
    );

    const drafts: Draft[] = [
      ...logged
        .filter((e) => canPayments || e.category !== Cat.PAYMENTS)
        .map((e) => this.redact(e, canPayments, canAttendance)),
      ...(await this.lifecycle(studentId, student, statusEvents)),
      ...(await this.enrollments(studentId, logged, statusEvents, canPayments)),
      ...(await this.referral(studentId)),
      ...(await this.telegram(studentId)),
    ];
    if (canPayments) {
      drafts.push(
        ...(await this.receipts(studentId)),
        ...(await this.refunds(studentId)),
        ...(await this.discounts(studentId)),
      );
    }
    if (canAttendance) drafts.push(...(await this.attendance(studentId)));

    drafts.sort((a, b) => b.sortAt - a.sortAt || a.id.localeCompare(b.id));
    return {
      items: drafts.map((d) => {
        const item: Partial<Draft> = { ...d };
        delete item.sortAt;
        return item as StudentTimelineItem;
      }),
    };
  }

  // ── Jurnal ───────────────────────────────────────────────────────────────

  private async loggedEvents(studentId: number): Promise<Draft[]> {
    const rows = await this.q(
      `SELECT e.id, e.type, e.payload, e."occurredAt", e."groupId",
              g.name AS "groupName", ${this.userName('u')} AS "actorName", u.id AS "actorId"
         FROM student_events e
         LEFT JOIN groups g ON g.id = e."groupId"
         LEFT JOIN users u ON u.id = e."actorId"
        WHERE e."studentId" = $1`,
      [studentId],
    );
    const categoryOf: Record<string, Cat> = {
      [StudentEventType.STATUS_CHANGED]: Cat.STATUS,
      [StudentEventType.PROFILE_UPDATED]: Cat.PROFILE,
      [StudentEventType.TRANSFERRED]: Cat.GROUPS,
      [StudentEventType.PAYMENT_EXCLUDED]: Cat.PAYMENTS,
    };
    return rows
      .filter((r) => categoryOf[r.type])
      .map((r) =>
        this.at(r.occurredAt, {
          id: `event:${r.id}`,
          type: r.type as T,
          category: categoryOf[r.type],
          actor: this.ref(r.actorId, r.actorName),
          group: this.ref(r.groupId, r.groupName),
          details: r.payload ?? {},
        }),
      );
  }

  /**
   * Ruxsat bo'lmasa jurnal yozuvidan pul/davomat ma'lumotini olib tashlaydi:
   * ko'chirish voqeasi "Guruhlar" bo'limida, lekin uning ichida summalar bor.
   */
  private redact(
    e: Draft,
    canPayments: boolean,
    canAttendance: boolean,
  ): Draft {
    if (e.type !== T.TRANSFERRED) return e;
    const details = { ...e.details };
    if (!canPayments) {
      delete details.carriedOverAmount;
      delete details.refundedAmount;
      delete details.remainingDebt;
    }
    if (!canAttendance) delete details.deletedAttendance;
    return { ...e, details };
  }

  // ── Holat: yaratilgan, faollashgan, to'xtatilgan ─────────────────────────

  private async lifecycle(
    studentId: number,
    student: Row,
    statusEvents: Draft[],
  ): Promise<Draft[]> {
    const out: Draft[] = [];
    const [lead] = await this.q(
      `SELECT id, "createdAt" FROM leads WHERE "studentId" = $1 ORDER BY id LIMIT 1`,
      [studentId],
    );
    if (lead) {
      out.push(
        this.at(lead.createdAt, {
          id: `lead:${lead.id}`,
          type: T.LEAD_CREATED,
          category: Cat.STATUS,
        }),
      );
    }
    out.push(
      this.at(student.createdAt, {
        id: `student:${studentId}`,
        type: T.CREATED,
        category: Cat.STATUS,
        details: { fromLead: !!lead },
      }),
    );

    // Jurnal paydo bo'lishidan oldingi holatlar faqat shu ustunlardan
    // tiklanadi. Jurnalda yaqin vaqtda xuddi shu holat bo'lsa — takror.
    const loggedNear = (to: string, at: Date) =>
      statusEvents.some(
        (e) =>
          e.details.toStatus === to &&
          Math.abs(e.sortAt - new Date(at).getTime()) < 5 * 60_000,
      );
    if (
      student.activatedAt &&
      !loggedNear(StudentStatus.ACTIVE, student.activatedAt)
    ) {
      out.push(
        this.at(student.activatedAt, {
          id: `activated:${studentId}`,
          type: T.ACTIVATED,
          category: Cat.STATUS,
        }),
      );
    }
    if (
      student.status === StudentStatus.STOPPED &&
      student.stoppedAt &&
      !loggedNear(StudentStatus.STOPPED, student.stoppedAt)
    ) {
      out.push(
        this.at(student.stoppedAt, {
          id: `stopped:${studentId}`,
          type: T.STATUS_CHANGED,
          category: Cat.STATUS,
          details: { toStatus: StudentStatus.STOPPED, derived: true },
        }),
      );
    }
    return out;
  }

  // ── Guruhlar: qo'shildi, chiqdi, ko'chirildi ─────────────────────────────

  private async enrollments(
    studentId: number,
    logged: Draft[],
    statusEvents: Draft[],
    canPayments: boolean,
  ): Promise<Draft[]> {
    const rows = await this.q(
      `SELECT e.id, e."groupId", g.name AS "groupName", e."leftReason",
              TO_CHAR(e."joinedAt", 'YYYY-MM-DD') AS "joinedAt",
              TO_CHAR(e."leftAt", 'YYYY-MM-DD') AS "leftAt",
              e."createdAt", e."transferredToGroupId", e."transferredFromGroupId",
              tg.name AS "toGroupName"
         FROM student_group_enrollments e
         LEFT JOIN groups g ON g.id = e."groupId"
         LEFT JOIN groups tg ON tg.id = e."transferredToGroupId"
        WHERE e."studentId" = $1
        ORDER BY e."joinedAt", e.id`,
      [studentId],
    );
    const carried = canPayments ? await this.carriedOver(studentId) : new Map();
    const loggedTransfers = logged.filter((e) => e.type === T.TRANSFERRED);
    const statusOn = (to: string, date: string) =>
      statusEvents.some(
        (e) => e.details.toStatus === to && this.dayOf(e.sortAt) === date,
      );

    const out: Draft[] = [];
    rows.forEach((r, idx) => {
      const group = this.ref(r.groupId, r.groupName);
      // Ko'chirish bitta voqea: kelgan oyna alohida ko'rsatilmaydi.
      if (!r.transferredFromGroupId) {
        const reentry = rows
          .slice(0, idx)
          .some((p) => p.groupId === r.groupId && p.leftAt);
        if (!(reentry && statusOn(StudentStatus.ACTIVE, r.joinedAt))) {
          const sameDay =
            r.createdAt &&
            this.dayOf(new Date(r.createdAt).getTime()) === r.joinedAt;
          out.push(
            sameDay
              ? this.at(r.createdAt, {
                  id: `enroll:${r.id}:in`,
                  type: T.GROUP_JOINED,
                  category: Cat.GROUPS,
                  group,
                })
              : this.onDate(r.joinedAt, {
                  id: `enroll:${r.id}:in`,
                  type: T.GROUP_JOINED,
                  category: Cat.GROUPS,
                  group,
                }),
          );
        }
      }
      if (!r.leftAt) return;

      if (r.transferredToGroupId) {
        const isLogged = loggedTransfers.some(
          (e) =>
            e.details.fromGroupId === r.groupId &&
            e.details.toGroupId === r.transferredToGroupId &&
            e.details.transferDate === r.leftAt,
        );
        if (isLogged) return;
        out.push(
          this.onDate(r.leftAt, {
            id: `enroll:${r.id}:transfer`,
            type: T.TRANSFERRED,
            category: Cat.GROUPS,
            details: {
              fromGroupId: r.groupId,
              fromGroupName: r.groupName,
              toGroupId: r.transferredToGroupId,
              toGroupName: r.toGroupName,
              transferDate: r.leftAt,
              reason: r.leftReason,
              ...(canPayments
                ? {
                    carriedOverAmount:
                      carried.get(`${r.groupId}>${r.transferredToGroupId}`) ??
                      0,
                  }
                : {}),
            },
          }),
        );
        return;
      }

      if (
        r.leftReason === STOP_REASON &&
        statusOn(StudentStatus.STOPPED, r.leftAt)
      )
        return;
      out.push(
        this.onDate(r.leftAt, {
          id: `enroll:${r.id}:out`,
          type: T.GROUP_LEFT,
          category: Cat.GROUPS,
          group,
          details: { reason: r.leftReason },
        }),
      );
    });
    return out;
  }

  /** Ko'chirishda yangi guruhga o'tgan pul: `"from>to"` → summa. */
  private async carriedOver(studentId: number): Promise<Map<string, number>> {
    const rows = await this.q(
      `SELECT sp."groupId" AS "fromGroupId", p."groupId" AS "toGroupId",
              SUM(r.amount) AS amount
         FROM payment_receipts r
         JOIN payments p ON p.id = r."paymentId"
         JOIN payments sp ON sp.id = r."transferFromPaymentId"
        WHERE p."studentId" = $1
        GROUP BY 1, 2`,
      [studentId],
    );
    return new Map(
      rows.map((r) => [
        `${r.fromGroupId}>${r.toGroupId}`,
        Number(r.amount ?? 0),
      ]),
    );
  }

  // ── To'lovlar ────────────────────────────────────────────────────────────

  private async receipts(studentId: number): Promise<Draft[]> {
    // Ko'chirishda yaratilgan chek (`transferFromPaymentId`) kassaga tushgan
    // pul emas — u ko'chirish voqeasining ichida ko'rsatiladi.
    const rows = await this.q(
      `SELECT r.id, r.amount, r.status, r."paymentMethod", r."checkNo", r.comment,
              r."receivedAt", r."createdAt", r."confirmedAt",
              TO_CHAR(r."paidAt", 'YYYY-MM-DD') AS "paidAt",
              TO_CHAR(p."forMonth", 'YYYY-MM') AS "forMonth",
              p."groupId", g.name AS "groupName",
              ru.id AS "receiverId", ${this.userName('ru')} AS "receiverName",
              ${this.userName('cu')} AS "confirmedByName"
         FROM payment_receipts r
         JOIN payments p ON p.id = r."paymentId"
         LEFT JOIN groups g ON g.id = p."groupId"
         LEFT JOIN users ru ON ru.id = r."receivedById"
         LEFT JOIN users cu ON cu.id = r."confirmedById"
        WHERE p."studentId" = $1 AND r."transferFromPaymentId" IS NULL`,
      [studentId],
    );
    return rows.map((r) =>
      this.at(r.receivedAt ?? r.createdAt, {
        id: `receipt:${r.id}`,
        type: T.PAYMENT_RECEIVED,
        category: Cat.PAYMENTS,
        actor: this.ref(r.receiverId, r.receiverName),
        group: this.ref(r.groupId, r.groupName),
        details: {
          amount: Number(r.amount ?? 0),
          status: r.status,
          method: r.paymentMethod ?? null,
          checkNo: r.checkNo ?? null,
          forMonth: r.forMonth,
          paidAt: r.paidAt ?? null,
          comment: r.comment ?? null,
          confirmedByName: r.confirmedByName || null,
          confirmedAt: r.confirmedAt
            ? new Date(r.confirmedAt).toISOString()
            : null,
        },
      }),
    );
  }

  private async refunds(studentId: number): Promise<Draft[]> {
    const rows = await this.q(
      `SELECT p.id, p."refundedAmount", p."refundedAt", p."groupId", g.name AS "groupName",
              TO_CHAR(p."forMonth", 'YYYY-MM') AS "forMonth"
         FROM payments p
         LEFT JOIN groups g ON g.id = p."groupId"
        WHERE p."studentId" = $1 AND p."refundedAmount" > 0 AND p."refundedAt" IS NOT NULL`,
      [studentId],
    );
    return rows.map((r) =>
      this.at(r.refundedAt, {
        id: `refund:${r.id}`,
        type: T.PAYMENT_REFUNDED,
        category: Cat.PAYMENTS,
        group: this.ref(r.groupId, r.groupName),
        details: {
          amount: Number(r.refundedAmount ?? 0),
          forMonth: r.forMonth,
        },
      }),
    );
  }

  private async discounts(studentId: number): Promise<Draft[]> {
    // Davrlar forma har saqlanganda qayta yoziladi (createdAt yangilanadi),
    // shuning uchun ular kuchga kiradigan oyda ko'rsatiladi.
    const periods = await this.q(
      `SELECT d.id, d.percent, d.amount, d.reason, d."groupId", g.name AS "groupName",
              TO_CHAR(d."fromMonth", 'YYYY-MM-DD') AS "fromDate",
              TO_CHAR(d."fromMonth", 'YYYY-MM') AS "fromMonth",
              TO_CHAR(d."toMonth", 'YYYY-MM') AS "toMonth"
         FROM student_discount_periods d
         LEFT JOIN groups g ON g.id = d."groupId"
        WHERE d."studentId" = $1`,
      [studentId],
    );
    // Birinchi o'zgarishda eski qiymat ham bir vaqtda yoziladi — bitta
    // saqlashdan faqat eng kech `fromMonth` li qator (yangi qiymat) olinadi.
    const bases = await this.q(
      `SELECT DISTINCT ON (b."createdAt") b.id, b.percent, b.amount, b."monthlyFee",
              b.reason, b."createdAt", TO_CHAR(b."fromMonth", 'YYYY-MM') AS "fromMonth"
         FROM student_base_discounts b
        WHERE b."studentId" = $1
        ORDER BY b."createdAt", b."fromMonth" DESC`,
      [studentId],
    );
    return [
      ...periods.map((d) =>
        this.onDate(d.fromDate, {
          id: `discount:${d.id}`,
          type: T.DISCOUNT_PERIOD,
          category: Cat.PAYMENTS,
          group: this.ref(d.groupId, d.groupName),
          details: {
            percent: Number(d.percent ?? 0),
            amount: Number(d.amount ?? 0),
            fromMonth: d.fromMonth,
            toMonth: d.toMonth ?? null,
            reason: d.reason ?? null,
          },
        }),
      ),
      ...bases.map((b) =>
        this.at(b.createdAt, {
          id: `fee:${b.id}`,
          type: T.FEE_CHANGED,
          category: Cat.PAYMENTS,
          details: {
            monthlyFee: b.monthlyFee == null ? null : Number(b.monthlyFee),
            percent: Number(b.percent ?? 0),
            amount: Number(b.amount ?? 0),
            fromMonth: b.fromMonth,
            reason: b.reason ?? null,
          },
        }),
      ),
    ];
  }

  // ── Boshqa: tavsiya, Telegram, davomat ───────────────────────────────────

  private async referral(studentId: number): Promise<Draft[]> {
    const rows = await this.q(
      `SELECT r.id, r."createAt", rs.id AS "referrerId",
              TRIM(COALESCE(rs."firstName", '') || ' ' || COALESCE(rs."lastName", '')) AS "referrerName"
         FROM referrals r
         JOIN students rs ON rs.id = r."referrerStudentId"
        WHERE r."referredStudentId" = $1`,
      [studentId],
    );
    return rows.map((r) =>
      this.at(r.createAt, {
        id: `referral:${r.id}`,
        type: T.REFERRED,
        category: Cat.PROFILE,
        details: { referrerId: r.referrerId, referrerName: r.referrerName },
      }),
    );
  }

  private async telegram(studentId: number): Promise<Draft[]> {
    const rows = await this.q(
      `SELECT id, "firstName", "lastName", username, "linkedAt", "unlinkedAt", "blockedAt"
         FROM telegram_parent_links WHERE "studentId" = $1`,
      [studentId],
    );
    const out: Draft[] = [];
    for (const r of rows) {
      const details = {
        parentName: [r.firstName, r.lastName].filter(Boolean).join(' ') || null,
        username: r.username ?? null,
      };
      if (r.linkedAt) {
        out.push(
          this.at(r.linkedAt, {
            id: `telegram:${r.id}:in`,
            type: T.TELEGRAM_LINKED,
            category: Cat.PROFILE,
            details,
          }),
        );
      }
      const leftAt = r.unlinkedAt ?? r.blockedAt;
      if (leftAt) {
        out.push(
          this.at(leftAt, {
            id: `telegram:${r.id}:out`,
            type: T.TELEGRAM_UNLINKED,
            category: Cat.PROFILE,
            details: { ...details, blocked: !r.unlinkedAt },
          }),
        );
      }
    }
    return out;
  }

  private async attendance(studentId: number): Promise<Draft[]> {
    // "Keldi" belgilari tarixni to'ldirib yuboradi — faqat istisnolar.
    const rows = await this.q(
      `SELECT a.id, a.status, a.comment, a."groupId", g.name AS "groupName",
              TO_CHAR(a."lessonDate", 'YYYY-MM-DD') AS "lessonDate",
              u.id AS "actorId", ${this.userName('u')} AS "actorName"
         FROM attendance a
         LEFT JOIN groups g ON g.id = a."groupId"
         LEFT JOIN users u ON u.id = a."submittedById"
        WHERE a."studentId" = $1 AND a.status IN ('absent', 'late', 'excused')`,
      [studentId],
    );
    return rows.map((r) =>
      this.onDate(r.lessonDate, {
        id: `attendance:${r.id}`,
        type: T.ATTENDANCE,
        category: Cat.ATTENDANCE,
        actor: this.ref(r.actorId, r.actorName),
        group: this.ref(r.groupId, r.groupName),
        details: { status: r.status, comment: r.comment ?? null },
      }),
    );
  }

  // ── Yordamchilar ─────────────────────────────────────────────────────────

  private q(sql: string, params: unknown[]): Promise<Row[]> {
    return this.dataSource.query(sql, params);
  }

  private userName(alias: string): string {
    return `NULLIF(TRIM(COALESCE(${alias}."firstName", '') || ' ' || COALESCE(${alias}."lastName", '')), '')`;
  }

  private ref(id: number | null, name: string | null): TimelineRef | null {
    return id ? { id: Number(id), name: name ?? '' } : null;
  }

  private dayOf(ms: number): string {
    return dayjs(ms).tz(TZ).format('YYYY-MM-DD');
  }

  private base(
    partial: Pick<StudentTimelineItem, 'id' | 'type' | 'category'> &
      Partial<StudentTimelineItem>,
  ) {
    return {
      actor: null,
      group: null,
      details: {},
      ...partial,
    };
  }

  /** Vaqti aniq voqea. */
  private at(
    when: Date | string,
    partial: Pick<StudentTimelineItem, 'id' | 'type' | 'category'> &
      Partial<StudentTimelineItem>,
  ): Draft {
    const d = new Date(when);
    return {
      ...this.base(partial),
      occurredAt: d.toISOString(),
      dateOnly: false,
      sortAt: d.getTime(),
    };
  }

  /** Faqat sanasi ma'lum voqea (`YYYY-MM-DD`). */
  private onDate(
    date: string,
    partial: Pick<StudentTimelineItem, 'id' | 'type' | 'category'> &
      Partial<StudentTimelineItem>,
  ): Draft {
    return {
      ...this.base(partial),
      occurredAt: date,
      dateOnly: true,
      sortAt: dayjs.tz(date, TZ).valueOf(),
    };
  }
}
