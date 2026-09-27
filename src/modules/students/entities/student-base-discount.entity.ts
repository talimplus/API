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

/**
 * O'quvchining doimiy (davrsiz) chegirmasi tarixi — oy aniqligida.
 *
 * MUHIM: to'lovlar uchun doimiy chegirmaning YAGONA MANBASI shu jadval.
 * `students.discountPercent / discountAmount` — admin oxirgi marta kiritgan
 * qiymat (forma va ro'yxatda ko'rsatish uchun). Tarix bo'lmasa (chegirma hech
 * qachon o'zgartirilmagan) hisob o'sha ustunlardan olinadi.
 *
 * Qoida: bir oy uchun bitta qator (studentId + fromMonth unique). Oy uchun
 * amaldagi chegirma — `fromMonth <= forMonth` shartiga mos ENG OXIRGI qator;
 * mos qator bo'lmasa — eng birinchi qator.
 */
@Entity('student_base_discounts')
@Index(['studentId', 'fromMonth'], { unique: true })
export class StudentBaseDiscount {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

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
