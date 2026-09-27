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

@Entity('student_discount_periods')
@Index(['studentId', 'fromMonth', 'toMonth'])
export class StudentDiscountPeriod {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

  /**
   * Month start (DATE, first day of month). Inclusive.
   */
  @Column({ type: 'date' })
  fromMonth: Date;

  /**
   * Month start (DATE, first day of month). Exclusive upper bound. NULL = permanent (no end).
   */
  @Column({ type: 'date', nullable: true })
  toMonth?: Date | null;

  @Column({ type: 'numeric', default: 0 })
  percent: number;

  /**
   * Oyiga ayiriladigan qat'iy summa (so'm). Bir davrda `percent` yoki `amount`
   * ishlatiladi. Faqat to'liq oylarga qo'llanadi — oy o'rtasida kelgan
   * o'quvchida keyingi oydan boshlanadi.
   */
  @Column({ type: 'numeric', default: 0 })
  amount: number;

  /**
   * Chegirma qaysi guruhga (fanga). NULL — o'quvchining barcha guruhlariga.
   * Ikki fanda o'qiganlarga chegirma odatda arzonroq fanga beriladi.
   */
  @ManyToOne(() => Group, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'groupId' })
  group?: Group | null;

  @Column({ type: 'int', nullable: true })
  groupId?: number | null;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
