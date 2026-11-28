import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '@/modules/audit-logs/entities/audit-log.entity';
import { QueryAuditLogsDto } from '@/modules/audit-logs/dto/query-audit-logs.dto';
import { CurrentUser } from '@/common/types/current.user';

export type AuditLogInput = Omit<AuditLog, 'id' | 'createdAt' | 'actor'>;

const ACTOR_SELECT = [
  'actor.id',
  'actor.firstName',
  'actor.lastName',
  'actor.role',
];

/**
 * Harakatlar jurnali. Yozish (`record`) **hech qachon xato tashlamaydi** va
 * kutilmaydi — jurnal yozilmasa ham asosiy amal to'xtamasligi kerak
 * (`student_events`, Telegram bilan bir xil tamoyil).
 */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  record(input: AuditLogInput): void {
    this.repo
      .insert(input as any)
      .catch((e) => {
        // Yo'q filial id'si (masalan 422 bilan qaytgan so'rov body'sidan) —
        // yozuv yo'qolmasin, filialsiz yoziladi.
        if ((e as any)?.code === '23503' && input.centerId) {
          return this.repo.insert({ ...input, centerId: null } as any);
        }
        throw e;
      })
      .catch((e) => {
        this.logger.warn(
          `audit_logs yozilmadi (${input.method} ${input.path}): ${
            (e as Error).message
          }`,
        );
      });
  }

  async list(user: CurrentUser, query: QueryAuditLogsDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 30;
    const qb = this.repo
      .createQueryBuilder('l')
      .leftJoin('l.actor', 'actor')
      .select([
        'l.id',
        'l.createdAt',
        'l.actorId',
        'l.module',
        'l.action',
        'l.method',
        'l.path',
        'l.url',
        'l.summary',
        'l.entityId',
        'l.statusCode',
        'l.success',
        'l.errorMessage',
        'l.ip',
        'l.durationMs',
        ...ACTOR_SELECT,
      ])
      .where('l.organizationId = :org', { org: user.organizationId });

    if (query.fromDate) {
      qb.andWhere('l.createdAt >= CAST(:from AS date)', {
        from: query.fromDate,
      });
    }
    if (query.toDate) {
      qb.andWhere(`l.createdAt < CAST(:to AS date) + INTERVAL '1 day'`, {
        to: query.toDate,
      });
    }
    if (query.actorId) {
      qb.andWhere('l.actorId = :actorId', { actorId: query.actorId });
    }
    if (query.module)
      qb.andWhere('l.module = :module', { module: query.module });
    if (query.action)
      qb.andWhere('l.action = :action', { action: query.action });
    if (query.success !== undefined) {
      qb.andWhere('l.success = :success', { success: query.success });
    }
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        '(l.url ILIKE :s OR l.summary ILIKE :s OR l.entityId = :exact)',
        { s: `%${search.replace(/[%_\\]/g, '\\$&')}%`, exact: search },
      );
    }

    const [rows, total] = await qb
      .orderBy('l.createdAt', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    return {
      data: rows.map((r) => this.toDto(r)),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(user: CurrentUser, id: string) {
    const row = await this.repo
      .createQueryBuilder('l')
      .leftJoin('l.actor', 'actor')
      .addSelect(ACTOR_SELECT)
      .where('l.id = :id AND l.organizationId = :org', {
        id,
        org: user.organizationId,
      })
      .getOne();
    if (!row) throw new NotFoundException('Jurnal yozuvi topilmadi');
    return {
      ...this.toDto(row),
      handler: row.handler,
      params: row.params,
      query: row.query,
      body: row.body,
      userAgent: row.userAgent,
      centerId: row.centerId,
    };
  }

  private toDto(r: AuditLog) {
    return {
      id: Number(r.id),
      createdAt: r.createdAt,
      actor: r.actor
        ? {
            id: r.actor.id,
            firstName: r.actor.firstName,
            lastName: r.actor.lastName,
            role: r.actor.role,
          }
        : null,
      module: r.module,
      action: r.action,
      method: r.method,
      path: r.path,
      url: r.url,
      summary: r.summary,
      entityId: r.entityId,
      statusCode: r.statusCode,
      success: r.success,
      errorMessage: r.errorMessage,
      ip: r.ip,
      durationMs: r.durationMs,
    };
  }
}
