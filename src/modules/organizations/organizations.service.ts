import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './entities/organizations.entity';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepo: Repository<Organization>,
  ) {}

  async create(data: Partial<Organization>) {
    const org = this.organizationRepo.create(data);
    return this.organizationRepo.save(org);
  }

  async findById(id: number) {
    return this.organizationRepo.findOne({ where: { id } });
  }

  async findByIdWithSubscription(id: number): Promise<Organization> {
    return this.organizationRepo.findOne({
      where: { id },
      relations: ['subscriptions'],
    });
  }
}
