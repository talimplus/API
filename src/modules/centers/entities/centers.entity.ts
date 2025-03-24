import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { User } from '@/modules/users/entities/user.entity';

@Entity('centers')
export class Center {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @ManyToOne(() => Organization, (organization) => organization.centers, {
    onDelete: 'CASCADE',
  })
  organization: Organization;

  @OneToMany(() => User, (user) => user.center)
  users: User[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
