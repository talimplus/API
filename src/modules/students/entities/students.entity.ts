import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  OneToOne,
} from 'typeorm';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { User } from '@/modules/users/entities/user.entity';

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

  @Column({ type: 'numeric', nullable: true })
  monthlyFee: number;

  @Column({ type: 'decimal', default: 0 })
  referralDiscount: number;

  @Column({ type: 'enum', enum: StudentStatus, default: StudentStatus.NEW })
  status: StudentStatus;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => Group, { onDelete: 'SET NULL', nullable: true })
  group: Group;

  @OneToOne(() => User, (user) => user.student, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  user: User;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
