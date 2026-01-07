import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  OneToOne,
  OneToMany,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Attendance } from '@/modules/attendance/entities/attendance.entity';

@Entity('students')
export class Student {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column()
  phone: string;

  @Column({ type: 'date' })
  birthDate: Date;

  @OneToMany(() => Payment, (payment) => payment.student)
  payments: Payment[];

  @Column({ type: 'numeric', nullable: true })
  monthlyFee: number;

  /**
   * Universal discount percent (0..100). Applies to all payments for this student.
   * Examples: referral, voucher, manual discount.
   */
  @Column({ type: 'numeric', default: 0 })
  discountPercent: number;

  @Column({ type: 'text', nullable: true })
  discountReason?: string | null;

  @Column({ type: 'enum', enum: StudentStatus, default: StudentStatus.NEW })
  status: StudentStatus;

  /**
   * Timestamp when student first became ACTIVE.
   * If unknown historically, fallback to createdAt at runtime.
   */
  @Column({ type: 'timestamp', nullable: true })
  activatedAt?: Date | null;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @OneToMany(() => Attendance, (a) => a.student)
  attendance: Attendance[];

  @ManyToMany(() => Group, (group) => group.students)
  @JoinTable()
  groups: Group[];

  @OneToOne(() => User, (user) => user.student, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  user: User;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
