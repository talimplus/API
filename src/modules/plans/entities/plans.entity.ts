import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { Subscription } from '@/modules/subscriptions/entities/subscriptions.entity';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ nullable: true })
  maxCenters: number;

  @Column({ nullable: true })
  maxUsers: number;

  @Column({ nullable: true })
  maxStudents: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @OneToMany(() => Subscription, (subscription) => subscription.plan)
  subscriptions: Subscription[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
