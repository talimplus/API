import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { User } from '@/modules/users/entities/user.entity';

@Entity('centers')
export class Center {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ default: false })
  isDefault: boolean;

  @ManyToOne(() => Organization, (organization) => organization.centers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ nullable: true })
  organizationId: number | null;

  @OneToMany(() => User, (user) => user.center)
  users: User[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
