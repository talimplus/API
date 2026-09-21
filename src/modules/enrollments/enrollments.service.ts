import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { StudentGroupEnrollment } from '@/modules/enrollments/entities/student-group-enrollment.entity';

/** Bitta a'zolik oynasi: `joinedAt` inclusive, `leftAt` exclusive. */
export interface EnrollmentWindow {
  joinedAt: string; // YYYY-MM-DD
  leftAt: string | null; // YYYY-MM-DD yoki null (hali a'zo)
}

/**
 * `date` ustuni pg drayveridan Date bo'lib ham, string bo'lib ham kelishi
 * mumkin. Timezone siljishisiz YYYY-MM-DD ga keltiramiz.
 */
export function toDateOnly(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (m) return m[0];
    return dayjs(value).format('YYYY-MM-DD');
  }
  return dayjs(value).format('YYYY-MM-DD');
}

/**
 * O'quvchi ↔ guruh a'zolik oynalari bilan ishlaydigan servis.
 *
 * Bu — to'lov proratsiyasining chegaralari uchun **yagona manba**. Junction
 * jadval (`students_groups_groups`) faqat "hozir qaysi guruhda" degan savolga
 * javob beradi; "qachondan qachongacha o'qidi" shu yerda saqlanadi.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectRepository(StudentGroupEnrollment)
    private readonly repo: Repository<StudentGroupEnrollment>,
  ) {}

  /** (studentId:groupId) -> oynalar. Har billing operatsiyasi boshida tozalanadi. */
  private cache = new Map<string, EnrollmentWindow[]>();

  clearCache() {
    this.cache.clear();
  }

  private key(studentId: number, groupId: number) {
    return `${studentId}:${groupId}`;
  }

  private normalize(rows: StudentGroupEnrollment[]): EnrollmentWindow[] {
    return rows
      .map((r) => ({
        joinedAt: toDateOnly(r.joinedAt) as string,
        leftAt: toDateOnly(r.leftAt),
      }))
      .filter((w) => Boolean(w.joinedAt))
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  async getWindows(
    studentId: number,
    groupId: number,
  ): Promise<EnrollmentWindow[]> {
    const key = this.key(studentId, groupId);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const rows = await this.repo.find({
      where: { studentId, groupId },
      order: { joinedAt: 'ASC', id: 'ASC' },
    });
    const windows = this.normalize(rows);
    this.cache.set(key, windows);
    return windows;
  }

  /**
   * Berilgan oy uchun amal qiladigan a'zolik chegaralari.
   *
   * Oy bilan kesishgan oynalar olinadi; bir necha bo'lsa (o'quvchi shu oyda
   * chiqib qayta qo'shilgan) eng erta `joinedAt` va eng kech `leftAt` olinadi —
   * ya'ni oradagi uzilish uchun ham pul so'raladi, lekin ikki marta emas.
   * Bu juda kam uchraydigan holat; aniqroq kerak bo'lsa davomat orqali
   * qo'lda `manualExcludedAmount` bilan to'g'rilanadi.
   *
   * Oyna umuman topilmasa `null` — chaqiruvchi eski xatti-harakatga qaytadi.
   */
  async resolveWindowForMonth(
    studentId: number,
    groupId: number,
    forMonth: string, // YYYY-MM-01
  ): Promise<EnrollmentWindow | null> {
    const windows = await this.getWindows(studentId, groupId);
    if (!windows.length) return null;

    const monthStart = dayjs(forMonth).startOf('month').format('YYYY-MM-DD');
    const monthEnd = dayjs(forMonth).endOf('month').format('YYYY-MM-DD');

    // `leftAt` exclusive: oy boshida chiqqan bo'lsa shu oyda dars yo'q.
    const overlapping = windows.filter(
      (w) => w.joinedAt <= monthEnd && (!w.leftAt || w.leftAt > monthStart),
    );
    if (!overlapping.length) {
      // Oy bilan kesishmaydi: o'quvchi bu oyda bu guruhda o'qimagan. Oxirgi
      // oynani qaytaramiz — u chegara sifatida ishlatilganda darslar baribir
      // oynadan tashqarida qoladi va billable = 0 chiqadi (oy oynadan oldin
      // bo'lsa joinedAt to'sadi, keyin bo'lsa leftAt to'sadi).
      const last = windows[windows.length - 1];
      return { joinedAt: last.joinedAt, leftAt: last.leftAt };
    }

    const joinedAt = overlapping.reduce(
      (min, w) => (w.joinedAt < min ? w.joinedAt : min),
      overlapping[0].joinedAt,
    );
    const hasOpen = overlapping.some((w) => !w.leftAt);
    const leftAt = hasOpen
      ? null
      : overlapping.reduce(
          (max, w) => ((w.leftAt as string) > max ? (w.leftAt as string) : max),
          overlapping[0].leftAt as string,
        );

    return { joinedAt, leftAt };
  }

  /**
   * Guruhga qo'shilishni yozadi. Ochiq oyna allaqachon bo'lsa — hech narsa
   * qilinmaydi (idempotent), lekin `joinedAt` erta sanaga tuzatilishi mumkin.
   */
  async open(
    studentId: number,
    groupId: number,
    joinedAt: string,
    opts?: { transferredFromGroupId?: number | null },
  ): Promise<StudentGroupEnrollment> {
    const date = toDateOnly(joinedAt) as string;

    const existing = await this.repo.findOne({
      where: { studentId, groupId, leftAt: IsNull() },
    });
    if (existing) {
      const current = toDateOnly(existing.joinedAt) as string;
      if (date < current) {
        existing.joinedAt = date;
        await this.repo.save(existing);
      }
      this.cache.delete(this.key(studentId, groupId));
      return existing;
    }

    const saved = await this.repo.save(
      this.repo.create({
        studentId,
        groupId,
        joinedAt: date,
        transferredFromGroupId: opts?.transferredFromGroupId ?? null,
      }),
    );
    this.cache.delete(this.key(studentId, groupId));
    return saved;
  }

  /**
   * Guruhdan chiqishni yozadi (ochiq oynani yopadi). Ochiq oyna bo'lmasa —
   * hech narsa qilinmaydi.
   *
   * `leftAt` hech qachon `joinedAt` dan oldin bo'lmaydi: o'sha kuni qo'shilib
   * o'sha kuni chiqarilsa oyna nol uzunlikda qoladi (billable = 0).
   */
  async close(
    studentId: number,
    groupId: number,
    leftAt: string,
    opts?: { reason?: string | null; transferredToGroupId?: number | null },
  ): Promise<StudentGroupEnrollment | null> {
    const existing = await this.repo.findOne({
      where: { studentId, groupId, leftAt: IsNull() },
    });
    if (!existing) return null;

    const joined = toDateOnly(existing.joinedAt) as string;
    let date = toDateOnly(leftAt) as string;
    if (date < joined) date = joined;

    existing.leftAt = date;
    existing.leftReason = opts?.reason ?? existing.leftReason ?? null;
    existing.transferredToGroupId = opts?.transferredToGroupId ?? null;
    const saved = await this.repo.save(existing);
    this.cache.delete(this.key(studentId, groupId));
    return saved;
  }

  /**
   * O'quvchining guruhlar ro'yxati almashganda a'zolik oynalarini moslaydi.
   * `students.update` dagi oddiy (ko'chirishsiz) tahrir uchun.
   */
  async syncForStudent(args: {
    studentId: number;
    previousGroupIds: number[];
    nextGroupIds: number[];
    date: string;
    reason?: string | null;
  }): Promise<void> {
    const { studentId, previousGroupIds, nextGroupIds, date, reason } = args;
    const prev = new Set(previousGroupIds);
    const next = new Set(nextGroupIds);

    for (const gid of prev) {
      if (!next.has(gid)) {
        await this.close(studentId, gid, date, { reason: reason ?? null });
      }
    }
    for (const gid of next) {
      if (!prev.has(gid)) {
        await this.open(studentId, gid, date);
      }
    }
  }

  /**
   * Guruh jurnali uchun: berilgan sana oralig'ida shu guruhda o'qigan
   * o'quvchilar (hozir chiqib ketganlari ham). Front `joinedAt`/`leftAt`
   * bo'yicha kataklarni yopadi.
   */
  async listForGroupRange(
    groupId: number,
    from: string,
    to: string,
  ): Promise<Map<number, EnrollmentWindow>> {
    const rows = await this.repo
      .createQueryBuilder('e')
      .where('e.groupId = :groupId', { groupId })
      .andWhere('e.joinedAt <= :to', { to })
      .andWhere('(e.leftAt IS NULL OR e.leftAt > :from)', { from })
      .orderBy('e.joinedAt', 'ASC')
      .getMany();

    const map = new Map<number, EnrollmentWindow>();
    for (const r of rows) {
      const joinedAt = toDateOnly(r.joinedAt) as string;
      const leftAt = toDateOnly(r.leftAt);
      const prev = map.get(r.studentId);
      if (!prev) {
        map.set(r.studentId, { joinedAt, leftAt });
        continue;
      }
      // Bir nechta oyna bo'lsa — eng keng chegarani beramiz.
      map.set(r.studentId, {
        joinedAt: joinedAt < prev.joinedAt ? joinedAt : prev.joinedAt,
        leftAt:
          prev.leftAt === null || leftAt === null
            ? null
            : leftAt > prev.leftAt
              ? leftAt
              : prev.leftAt,
      });
    }
    return map;
  }

  /** Bir nechta o'quvchining shu guruhdagi ochiq a'zoligi bormi. */
  async findOpenForStudents(
    groupId: number,
    studentIds: number[],
  ): Promise<Map<number, StudentGroupEnrollment>> {
    if (!studentIds.length) return new Map();
    const rows = await this.repo.find({
      where: { groupId, studentId: In(studentIds), leftAt: IsNull() },
    });
    return new Map(rows.map((r) => [r.studentId, r]));
  }

  /** O'quvchining barcha a'zolik tarixi (o'quvchi kartasi uchun). */
  async listForStudent(studentId: number): Promise<StudentGroupEnrollment[]> {
    return this.repo.find({
      where: { studentId },
      relations: ['group'],
      order: { joinedAt: 'DESC', id: 'DESC' },
    });
  }
}
