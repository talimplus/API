import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { Student } from '@/modules/students/entities/students.entity';
import { Center } from '@/modules/centers/entities/centers.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { IsNotEmpty, IsString, Min } from 'class-validator';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @IsNotEmpty()
  @IsString()
  @Column({ unique: true })
  @Min(6)
  login: string;

  @Column({ unique: true })
  phone: string;

  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.ADMIN })
  role: UserRole;

  @Column({ nullable: true })
  salary: number;

  @Column({ nullable: true })
  commissionPercentage: number;

  @OneToOne(() => Student, (student) => student.user, { nullable: true })
  @JoinColumn()
  student: Student;

  @ManyToOne(() => Center, (center) => center.users, { onDelete: 'CASCADE' })
  center: Center;

  @ManyToOne(() => Organization, (org) => org.users, { onDelete: 'CASCADE' })
  organization: Organization;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
