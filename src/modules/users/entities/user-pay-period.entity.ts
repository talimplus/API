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

/**
 * Xodim oyligi va komissiya foizining TARIXI (oy aniqligida).
 *
 * Qoida: oy uchun qiymat — `fromMonth <= forMonth` ga mos eng oxirgi qator,
 * bo'lmasa eng birinchisi, jadval bo'sh bo'lsa `users.salary` /
 * `users.commissionPercentage`. O'zgartirilgan oydan boshlab yangi qiymat
 * amal qiladi; oldingi oylar (keyin kech to'langan o'quvchi puli ham) eski
 * foizda hisoblanadi.
 */
@Entity('user_pay_periods')
@Index(['userId', 'fromMonth'], { unique: true })
export class UserPayPeriod {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  /** Kuchga kirgan oy (YYYY-MM-01, inclusive). */
  @Column({ type: 'date' })
  fromMonth: Date;

  @Column({ type: 'numeric', default: 0 })
  salary: number;

  @Column({ type: 'numeric', default: 0 })
  commissionPercentage: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
