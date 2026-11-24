import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';

/**
 * O'quvchining doimiy (davrsiz) chegirmasi tarixi — oy aniqligida.
 *
 * MUHIM: to'lovlar uchun doimiy chegirmaning YAGONA MANBASI shu jadval.
 * `students.discountPercent / discountAmount` — admin oxirgi marta kiritgan
 * qiymat (forma va ro'yxatda ko'rsatish uchun). Tarix bo'lmasa (chegirma hech
 * qachon o'zgartirilmagan) hisob o'sha ustunlardan olinadi.
 *
 * Guruh bo'yicha (2026-11-24): `groupId` NULL — barcha guruhlarga, aks holda
 * faqat o'sha guruhga; har biri o'z tarixiga ega va qo'shiladi (stacking).
 * Yagonalik — DB indeksi (studentId, COALESCE(groupId, 0), fromMonth).
 *
 * Qoida: bir oy uchun bitta qator. Oy uchun
 * amaldagi chegirma — `fromMonth <= forMonth` shartiga mos ENG OXIRGI qator;
 * mos qator bo'lmasa — eng birinchi qator.
 */
@Entity('student_base_discounts')
@Index(['studentId', 'fromMonth'])
export class StudentBaseDiscount {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

  @ManyToOne(() => Group, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'groupId' })
  group?: Group | null;

  /** NULL — barcha guruhlarga. */
  @Column({ type: 'int', nullable: true })
  groupId?: number | null;

  /** Chegirma kuchga kiradigan oy (DATE, oyning 1-sanasi). Inclusive. */
  @Column({ type: 'date' })
  fromMonth: Date;

  @Column({ type: 'numeric', default: 0 })
  percent: number;

  /** So'm/oy — faqat to'liq oyga qo'llanadi (`computeAmountDue`). */
  @Column({ type: 'numeric', default: 0 })
  amount: number;

  /**
   * Shu oydan amaldagi shaxsiy narx (0 — guruh narxi). NULL — eski qator,
   * `students.monthlyFee` ishlatiladi.
   */
  @Column({ type: 'numeric', nullable: true })
  monthlyFee?: number | null;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
