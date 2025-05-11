import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Center } from '@/modules/centers/entities/centers.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { StudentStatus } from '@/common/enums/students-status.enums';

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

  @Column({ type: 'enum', enum: StudentStatus, default: StudentStatus.YANGI })
  status: StudentStatus;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => Group, { onDelete: 'SET NULL', nullable: true })
  group: Group;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
