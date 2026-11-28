import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/modules/users/entities/user.entity';
import { AuditAction, AuditModule } from '@/modules/audit-logs/audit-log.enums';

/**
 * Harakatlar jurnali: ma'lumotni o'zgartirgan har bir so'rov
 * (`AuditLogInterceptor` yozadi). Sirlar (parol, token, pasport) `body` ga
 * niqoblangan holda tushadi — `sanitizeForAudit`.
 */
@Entity('audit_logs')
@Index(['organizationId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column()
  organizationId: number;

  @Column({ type: 'int', nullable: true })
  centerId: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor?: User | null;

  /** Amalni bajargan xodim (null — o'chirilgan xodim). */
  @Column({ type: 'int', nullable: true })
  actorId: number | null;

  @Column({ type: 'varchar', length: 40 })
  module: AuditModule;

  @Column({ type: 'varchar', length: 20 })
  action: AuditAction;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  /** Route shabloni: `/students/:id`. */
  @Column({ type: 'varchar', length: 255 })
  path: string;

  /** Haqiqiy manzil: `/students/42?x=1`. */
  @Column({ type: 'text' })
  url: string;

  /** `StudentsController.update` */
  @Column({ type: 'varchar', length: 160, nullable: true })
  handler: string | null;

  /** Swagger `@ApiOperation` summary — amalning odamga tushunarli nomi. */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** Qaysi obyekt: route `:id` yoki yaratilgan yozuvning `id` si. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  params: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  query: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  body: unknown;

  @Column({ type: 'int' })
  statusCode: number;

  @Column({ type: 'boolean' })
  success: boolean;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ type: 'int', default: 0 })
  durationMs: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;
}
