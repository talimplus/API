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

/**
 * Xodimga mukofot — tanlangan oy oyligiga qo'shiladi va oylik bilan birga
 * beriladi (`staff_salaries.bonusAmount` — shu oy yig'indisi). Sabab majburiy:
 * xodim uni o'z sahifasida ko'radi.
 */
@Entity('staff_bonuses')
@Index(['userId', 'forMonth'])
export class StaffBonus {
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

  /** Ish oyi (YYYY-MM-01) — mukofot shu oy oyligiga qo'shiladi. */
  @Column({ type: 'date' })
  forMonth: Date;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  @Column({ type: 'text' })
  reason: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User | null;

  @Column({ nullable: true })
  createdById: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
