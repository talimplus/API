import { Referral } from '@/modules/referrals/entities/referal.entity';
import { StudentsService } from '@/modules/students/students.service';
import { InjectRepository } from '@nestjs/typeorm';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';

@Injectable()
export class ReferralsService {
  constructor(
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
    @Inject(forwardRef(() => StudentsService))
    private readonly studentsService: StudentsService,
  ) {}
  async create(referrerId: number, referredId: number) {
    const newReferral = this.referralRepo.create({
      referrerStudentId: referrerId,
      referredStudentId: referredId,
    } as any);
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
