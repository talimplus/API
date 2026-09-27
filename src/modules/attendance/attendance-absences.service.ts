import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Attendance } from '@/modules/attendance/entities/attendance.entity';
import { AttendanceStatus } from '@/modules/attendance/enums/attendance-status.enum';
import {
  AbsenceFollowUpDto,
  QueryAbsencesDto,
} from '@/modules/attendance/dto/query-absences.dto';
import { UserRole } from '@/common/enums/user-role.enums';
import { dayjs } from '@/shared/utils/dayjs';

const ABSENCE_STATUSES = [AttendanceStatus.ABSENT, AttendanceStatus.EXCUSED];

/**
 * Kelmagan o'quvchilar ro'yxati — qabulxona uchun.
 *
 * Maqsad: darsga kelmagan (`absent` — sababsiz, `excused` — sababli)
 * o'quvchilarga qo'ng'iroq qilib sababini bilish. Natija (`followUpNote`)
 * davomat qatoriga yoziladi, shuning uchun ro'yxatda "qo'ng'iroq
 * qilinmaganlar" alohida ko'rinadi.
 *
 * Chegara: tashkilot (majburiy) + filial. Admin filialni tanlaydi ("barcha
 * filiallar" bo'lsa butun tashkilot), qolganlar o'z filialida qamalgan.
 * O'qituvchi faqat o'z guruhlarini ko'radi.
 */
@Injectable()
export class AttendanceAbsencesService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
  ) {}

  private resolveCenterId(user: any, requested?: number): number | undefined {
    const isAdmin =
      user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
    if (isAdmin) return requested ? Number(requested) : undefined;
    return user.centerId ?? undefined;
  }

  /** Umumiy chegara (tashkilot, filial, o'qituvchi) — ro'yxat ham, statistika ham. */
  private scopedQuery(user: any, query: QueryAbsencesDto) {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .innerJoin('a.student', 's')
      .innerJoin('a.group', 'g')
      .innerJoin('g.center', 'c')
      .leftJoin('g.teacher', 't')
      .where('c.organizationId = :organizationId', {
        organizationId: user.organizationId,
      });

    const centerId = this.resolveCenterId(user, query.centerId);
    if (centerId) qb.andWhere('c.id = :centerId', { centerId });

    if (user.role === UserRole.TEACHER) {
      qb.andWhere('t.id = :selfId', { selfId: user.userId });
    }
    if (query.groupId)
      qb.andWhere('g.id = :groupId', { groupId: query.groupId });
    if (query.teacherId) {
      qb.andWhere('t.id = :teacherId', { teacherId: query.teacherId });
    }
    if (query.from) qb.andWhere('a.lessonDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('a.lessonDate <= :to', { to: query.to });

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(CONCAT(s.firstName, ' ', s.lastName) ILIKE :search
          OR CONCAT(s.lastName, ' ', s.firstName) ILIKE :search
          OR s.phone ILIKE :search
          OR COALESCE(s.secondPhone, '') ILIKE :search)`,
        { search: `%${search}%` },
      );
    }
    return qb;
  }

  private applyStatusFilters(
    qb: SelectQueryBuilder<Attendance>,
    query: QueryAbsencesDto,
  ) {
    qb.andWhere('a.status IN (:...statuses)', {
      statuses: query.status ? [query.status] : ABSENCE_STATUSES,
    });
    if (query.followedUp === true) qb.andWhere('a.followedUpAt IS NOT NULL');
    if (query.followedUp === false) qb.andWhere('a.followedUpAt IS NULL');
    return qb;
  }

  async list(user: any, query: QueryAbsencesDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const perPage = Math.min(
      100,
      query.perPage && query.perPage > 0 ? query.perPage : 20,
    );

    const qb = this.applyStatusFilters(this.scopedQuery(user, query), query)
      .leftJoin('a.followedUpBy', 'fu')
      .select([
        'a.id',
        'a.lessonDate',
        'a.status',
        'a.comment',
        'a.followUpNote',
        'a.followedUpAt',
        's.id',
        's.firstName',
        's.lastName',
        's.phone',
        's.secondPhone',
        'g.id',
        'g.name',
        't.id',
        't.firstName',
        't.lastName',
        'fu.id',
        'fu.firstName',
        'fu.lastName',
      ])
      .orderBy('a.lessonDate', 'DESC')
      .addOrderBy('g.name', 'ASC')
      .addOrderBy('s.firstName', 'ASC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();

    // Shu oraliqda o'quvchi shu guruhda necha marta kelmagani — ketma-ket
    // kelmayotganlarni birinchi navbatda qo'ng'iroq qilish uchun.
    const counts = await this.countsPerStudentGroup(user, query, rows);

    return {
      data: rows.map((r) => ({
        id: r.id,
        lessonDate: dayjs(r.lessonDate).format('YYYY-MM-DD'),
        status: r.status,
        comment: r.comment ?? null,
        followUpNote: r.followUpNote ?? null,
        followedUpAt: r.followedUpAt ?? null,
        followedUpBy: r.followedUpBy
          ? {
              id: r.followedUpBy.id,
              firstName: r.followedUpBy.firstName,
              lastName: r.followedUpBy.lastName,
            }
          : null,
        student: {
          id: r.student.id,
          firstName: r.student.firstName,
          lastName: r.student.lastName,
          phone: r.student.phone ?? null,
          secondPhone: r.student.secondPhone ?? null,
        },
        group: { id: r.group.id, name: r.group.name },
        teacher: r.group.teacher
          ? {
              id: r.group.teacher.id,
              firstName: r.group.teacher.firstName,
              lastName: r.group.teacher.lastName,
            }
          : null,
        absencesInRange: counts.get(`${r.student.id}:${r.group.id}`) ?? 1,
      })),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
      summary: await this.summary(user, query),
    };
  }

  private async countsPerStudentGroup(
    user: any,
    query: QueryAbsencesDto,
    rows: Attendance[],
  ): Promise<Map<string, number>> {
    if (!rows.length) return new Map();
    const studentIds = Array.from(new Set(rows.map((r) => r.student.id)));
    const raw = await this.scopedQuery(user, { ...query, search: undefined })
      .andWhere('a.status IN (:...statuses)', { statuses: ABSENCE_STATUSES })
      .andWhere('s.id IN (:...studentIds)', { studentIds })
      .select('s.id', 'studentId')
      .addSelect('g.id', 'groupId')
      .addSelect('COUNT(a.id)', 'count')
      .groupBy('s.id')
      .addGroupBy('g.id')
      .getRawMany<{ studentId: number; groupId: number; count: string }>();
    return new Map(
      raw.map((r) => [`${r.studentId}:${r.groupId}`, Number(r.count)]),
    );
  }

  /** Sahifa tepasidagi kartochkalar (status va qo'ng'iroq filtrlarisiz). */
  private async summary(user: any, query: QueryAbsencesDto) {
    const raw = await this.scopedQuery(user, query)
      .andWhere('a.status IN (:...statuses)', { statuses: ABSENCE_STATUSES })
      .select(
        `COUNT(*) FILTER (WHERE a.status = '${AttendanceStatus.ABSENT}')`,
        'absent',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE a.status = '${AttendanceStatus.EXCUSED}')`,
        'excused',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE a.followedUpAt IS NULL)',
        'notFollowedUp',
      )
      .getRawOne<{ absent: string; excused: string; notFollowedUp: string }>();
    return {
      absent: Number(raw?.absent ?? 0),
      excused: Number(raw?.excused ?? 0),
      notFollowedUp: Number(raw?.notFollowedUp ?? 0),
    };
  }

  /** Qo'ng'iroq natijasini yozadi (bo'sh izoh — belgini olib tashlaydi). */
  async followUp(user: any, id: number, dto: AbsenceFollowUpDto) {
    const row = await this.attendanceRepo.findOne({
      where: { id },
      relations: ['group', 'group.center', 'group.teacher'],
    });
    if (!row || row.group?.center?.organizationId !== user.organizationId) {
      throw new NotFoundException('Davomat yozuvi topilmadi');
    }
    const centerId = this.resolveCenterId(user, undefined);
    if (centerId && row.group.center.id !== centerId) {
      throw new NotFoundException('Davomat yozuvi topilmadi');
    }
    if (
      user.role === UserRole.TEACHER &&
      row.group.teacher?.id !== user.userId
    ) {
      throw new ForbiddenException('Bu guruh sizga biriktirilmagan');
    }
    if (!ABSENCE_STATUSES.includes(row.status)) {
      throw new ForbiddenException(
        "Faqat kelmagan o'quvchi uchun qo'ng'iroq natijasi yoziladi",
      );
    }

    const note = dto.note?.trim() ?? '';
    await this.attendanceRepo.update(row.id, {
      followUpNote: note || null,
      followedUpAt: note ? new Date() : null,
      followedUpById: note ? user.userId : null,
    });
    return {
      id: row.id,
      followUpNote: note || null,
      followedUpAt: note ? new Date() : null,
    };
  }
}
