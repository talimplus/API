import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/modules/users/entities/user.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';

/**
 * Xodimning oyligidan ushlab qolinadigan summa (jarima).
 *
 * MUHIM: tizim hech qachon o'zi jarima solmaydi — summani admin yozadi.
 * Kechikishlar va topshirilmagan pullar faqat **asos** bo'lib ko'rsatiladi.
 *
 * Jarima oylikdan katta bo'lishi mumkin: o'sha oyda faqat sig'gani ushlanadi
 * (`appliedAmount`), qolgani ochiq qoladi va keyingi oyliklardan ushlanadi.
 * Qaysi oy qanchasini qopgani `staff_salary_deductions` da yoziladi.
 */
@Entity('staff_deductions')
@Index(['userId', 'sourceForMonth'])
export class StaffDeduction {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @ManyToOne(() => Center, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'centerId' })
  center: Center | null;

  @Column({ nullable: true })
  centerId: number | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column()
  organizationId: number;

  /** Jarima qaysi oy uchun yozilgan (YYYY-MM-01) */
  @Column({ type: 'date' })
  sourceForMonth: Date;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  /** Shu paytgacha oyliklardan ushlab qolingan qism */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  appliedAmount: number;

  @Column({
    type: 'enum',
    enum: StaffDeductionType,
    default: StaffDeductionType.OTHER,
  })
  type: StaffDeductionType;

  /** Sabab — majburiy, chunki xodim buni o'z sahifasida ko'radi */
  @Column({ type: 'text' })
  reason: string;

  /** To'liq qoplangan payt (appliedAmount === amount) */
  @Column({ type: 'timestamp', nullable: true })
  settledAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User | null;

  @Column({ nullable: true })
  createdById: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
