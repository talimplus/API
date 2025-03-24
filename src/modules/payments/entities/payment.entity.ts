import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Center } from '@/modules/centers/entities/centers.entity';

export enum PaymentStatus {
  TOQILDI = 'tolandi',
  QISMAN = 'qisman tolandi',
  TOLANMADI = 'tolanmadi',
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  student: Student;

  @Column({ type: 'decimal' })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.TOLANMADI,
  })
  status: PaymentStatus;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  paymentDate: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
