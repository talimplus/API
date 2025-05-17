import { Referral } from '@/modules/referrals/entities/referal.entity';
import { StudentsService } from '@/modules/students/students.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';

@Injectable()
export class ReferralsService {
  constructor(
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
    private readonly studentsService: StudentsService,
  ) {}
  async create(referrerId: number, referredId: number) {
    const referrer = await this.studentsService.findById(referrerId);
    const referred = await this.studentsService.findById(referredId);
    if (!referrer || !referred) {
      throw new Error('Bunday foydalanuvchilar mavjud emas');
    }
    const newReferral = this.referralRepo.create({
      referrerStudent: referrer,
      referredStudent: referred,
    });
    return this.referralRepo.save(newReferral);
  }

  async markAsDiscountApplied(id: number) {
    const referral = await this.referralRepo.findOne({ where: { id } });
    if (!referral) {
      throw new Error('Bunday referal mavjud emas');
    }
    referral.isDiscountApplied = true;
    return this.referralRepo.save(referral);
  }
}
