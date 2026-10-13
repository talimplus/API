import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { StudentEventType } from '@/modules/student-history/student-timeline.enums';

/**
 * O'quvchi bilan bog'liq, **boshqa jadvalda izi qolmaydigan** amal.
 * Qolgan tarix (cheklar, a'zolik oynalari, chegirmalar, davomat) o'z
 * jadvalidan o'qiladi — `StudentTimelineService` ikkalasini birlashtiradi.
 */
@Entity('student_events')
@Index(['studentId', 'occurredAt'])
export class StudentEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student?: Student;

  @Column()
  studentId: number;

  @Column()
  organizationId: number;

  @Column({ type: 'varchar', length: 40 })
  type: StudentEventType;

  /** Amalni bajargan xodim (null — tizim yoki o'chirilgan xodim). */
  @Column({ type: 'int', nullable: true })
  actorId: number | null;

  @Column({ type: 'int', nullable: true })
  groupId: number | null;

  /** Turga xos ma'lumot (oldingi/yangi holat, summalar, o'zgargan maydonlar). */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  payload: Record<string, unknown>;

  @Column({ type: 'timestamp', default: () => 'now()' })
  occurredAt: Date;
}
