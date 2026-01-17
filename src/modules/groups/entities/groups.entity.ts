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
import { Room } from '@/modules/rooms/entities/rooms.entity';
import { User } from '@/modules/users/entities/user.entity';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  /**
   * IANA timezone name, used for all lessonDate calculations and "today" comparisons.
   * Example: Asia/Tashkent
   */
  @Column({ default: 'Asia/Tashkent' })
  timezone: string;

  /**
   * Group start boundary in local group timezone.
   * Lesson existence is computed only within [startDate..endDate?].
   */
  @Column({ type: 'date', default: () => 'CURRENT_DATE' })
  startDate: Date;

  /**
   * Optional group end boundary in local group timezone (inclusive).
   */
  @Column({ type: 'date', nullable: true })
  endDate?: Date | null;

  @Column({ type: 'enum', enum: GroupStatus, default: GroupStatus.NEW })
  status: GroupStatus;

  /**
   * Group duration in months, used for auto-finishing (optional).
   * Example: 5 => 5 months.
   */
  @Column({ type: 'int', nullable: true })
  durationMonths?: number | null;

  /**
   * Timestamp when group was marked as STARTED.
   */
  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  subject: Subject;

  @Column({ type: 'numeric', nullable: true })
  monthlyFee: number;

  @ManyToOne(() => Center, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  room: Room;

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
