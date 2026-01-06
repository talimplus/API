import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { User } from '@/modules/users/entities/user.entity';
import { AttendanceStatus } from '@/modules/attendance/enums/attendance-status.enum';

@Entity('attendance')
@Index(['groupId', 'studentId', 'lessonDate'], { unique: true })
export class Attendance {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * DATE in group timezone (YYYY-MM-DD). Not a timestamp.
   */
  @Column({ type: 'date' })
  lessonDate: Date;

  @Column({
    type: 'enum',
    enum: AttendanceStatus,
    default: AttendanceStatus.PRESENT,
  })
  status: AttendanceStatus;

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @ManyToOne(() => Student, (student) => student.attendance, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column()
  studentId: number;

  @ManyToOne(() => Group, (group) => group.attendance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column()
  groupId: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'submittedById' })
  submittedBy?: User | null;

  @Column({ nullable: true })
  submittedById?: number | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  submittedAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  updatedAt: Date;
}
