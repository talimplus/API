import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  ManyToMany,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { GroupSchedule } from '@/modules/group_schedule/entities/group-schedule.entity';
import { Attendance } from '@/modules/attendance/entities/attendance.entity';
import { Subject } from '@/modules/subjects/entities/subjects.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { User } from '@/modules/users/entities/user.entity';

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

  @ManyToMany(() => Student, (student) => student.groups)
  students: Student[];

  @OneToMany(() => GroupSchedule, (schedule) => schedule.group)
  schedules: GroupSchedule[];

  @OneToMany(() => Attendance, (a) => a.group)
  attendance: Attendance[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
