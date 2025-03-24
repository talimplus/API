import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { Plan } from '@/modules/plans/entities/plans.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  EXPIRED = 'expired',
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  organization: Organization;

  @ManyToOne(() => Plan, (plan) => plan.subscriptions, { onDelete: 'SET NULL' })
  plan: Plan;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.PENDING,
  })
  status: SubscriptionStatus;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
