import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';

export enum PaymentStatus {
  PAID = 'paid',
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
}

@Entity('payments')
@Index(['studentId', 'groupId', 'forMonth'], { unique: true })
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

  @ManyToOne(() => Group, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column({ nullable: true })
  groupId: number | null;

  // NOTE: numeric(10,2) overflows for fees like 123,123,123.00 (needs >= 11 digits precision).
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amountDue: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  amountPaid: number;

  /**
   * How much money was refunded to the student for this payment (cumulative).
   * This preserves history while amountPaid can represent net received (after refunds).
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  refundedAmount: number;

  @Column({ type: 'timestamp', nullable: true })
  refundedAt?: Date | null;

  /**
   * Boshqa guruh to'loviga ko'chirilgan pul (kumulyativ). O'quvchi guruhini
   * o'zgartirganda eski guruhga ortiqcha to'lab qo'ygan summa naqd
   * qaytarilmaydi — u yangi guruh to'loviga o'tadi. Pul markazdan chiqmagani
   * uchun buni `refundedAmount` bilan aralashtirmaymiz.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  transferredOutAmount: number;

  /**
   * Soft deadline (usually 10th of month in group timezone).
   */
  @Column({ type: 'date', nullable: true })
  dueDate: Date | null;

  /**
   * Hard deadline (usually 15th of month).
   */
  @Column({ type: 'date', nullable: true })
  hardDueDate: Date | null;

  /**
   * Total scheduled lessons in the month for this group (schedule-driven).
   */
  @Column({ type: 'int', nullable: true })
  lessonsPlanned: number | null;

  /**
   * How many lessons the student must pay for that month (<= lessonsPlanned).
   * For mid-month activation, this is smaller.
   */
  @Column({ type: 'int', nullable: true })
  lessonsBillable: number | null;

  /**
   * How many billable lessons were marked EXCUSED (sababli) for this student in
   * this month. These are deducted from the billable lessons when computing
   * amountDue: effectiveBillable = lessonsBillable - lessonsExcused.
   * Absent (kelmadi) lessons are NOT deducted (student still pays).
   */
  @Column({ type: 'int', default: 0 })
  lessonsExcused: number;

  /**
   * Reception qo'lda chiqarib tashlagan summa (manual exclusion).
   * amountDue hisoblanganda oxirida ayiriladi:
   *   amountDue = prorated * (1 - discount/100) - manualExcludedAmount.
   * Recalc paytida saqlanadi (o'chib ketmaydi).
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  manualExcludedAmount: number;

  /**
   * Chiqarib tashlangan darslar soni (faqat ma'lumot uchun; summani
   * manualExcludedAmount belgilaydi).
   */
  @Column({ type: 'int', nullable: true })
  manualExcludedLessons?: number | null;

  /**
   * Chiqarib tashlash sababi (izoh). manualExcludedAmount > 0 bo'lsa majburiy.
   */
  @Column({ type: 'text', nullable: true })
  manualExcludedReason?: string | null;

  /**
   * Planned study end date for this month (YYYY-MM-DD).
   * If set, student plans to study only until this date (inclusive).
   * Used to calculate prorated payment amount.
   * Example: If student says "I'll study until 20th", set this to "2026-01-20".
   */
  @Column({ type: 'date', nullable: true })
  plannedStudyUntilDate?: Date | null;

  /**
   * Chek/invoice bazaviy raqami (masalan 1, 2, 3...). Har bir markaz (center)
   * ichida ketma-ket beriladi va shu oy uchun BIRINCHI to'lov (receipt)
   * qabul qilinganda bir marta biriktiriladi. Keyingi qisman to'lovlar (receipt)
   * shu raqamdan harf bilan hosil qilinadi: 1 -> 1-A -> 1-A-B ...
   */
  @Column({ type: 'int', nullable: true })
  invoiceNo?: number | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.UNPAID,
  })
  status: PaymentStatus;

  @Column({ type: 'date' })
  forMonth: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
