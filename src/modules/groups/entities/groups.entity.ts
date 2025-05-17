import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Student } from '@/modules/students/entities/students.entity';

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  subject: Subject;

  @Column({ type: 'numeric', nullable: true })
  monthlyFee: number;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  teacher: User;

  @OneToMany(() => Student, (student) => student.group)
  students: Student[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
