import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { User } from '@/modules/users/entities/user.entity';

export enum PaymentReceiptStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

@Entity('payment_receipts')
@Index(['paymentId', 'status'])
export class PaymentReceipt {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;

  @Column()
  paymentId: number;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'receivedById' })
  receivedBy?: User | null;

  @Column({ type: 'int', nullable: true })
  receivedById?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  receivedAt?: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'confirmedById' })
  confirmedBy?: User | null;

  @Column({ type: 'int', nullable: true })
  confirmedById?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt?: Date | null;

  @Column({ type: 'enum', enum: PaymentReceiptStatus, default: PaymentReceiptStatus.PENDING })
  status: PaymentReceiptStatus;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}

