import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscriptions.entity';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
  ) {}

  async create(data: Partial<Subscription>) {
    const sub = this.subRepo.create(data);
    return this.subRepo.save(sub);
  }

  async findByOrganization(organizationId: number) {
    return this.subRepo.find({
      where: { organization: { id: organizationId } },
      relations: ['plan'],
    });
  }
}
