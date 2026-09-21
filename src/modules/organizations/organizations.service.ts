import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './entities/organizations.entity';
import { UpdateBrandingDto } from './dto/update-branding.dto';

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

  /**
   * Kabinet brendingi — nom, logo, favicon.
   * Har qanday tizimga kirgan xodim o'qiy oladi (sidebar va tab sarlavhasi
   * shundan chiziladi), shuning uchun alohida ruxsat talab qilinmaydi.
   */
  async getBranding(organizationId: number) {
    const org = await this.organizationRepo.findOne({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Tashkilot topilmadi');
    return {
      organizationId: org.id,
      name: org.name,
      logoUrl: org.logoUrl ?? null,
      faviconUrl: org.faviconUrl ?? null,
      brandingUpdatedAt: org.brandingUpdatedAt ?? null,
    };
  }

  /** Bo'sh satr yuborilsa rasm olib tashlanadi (null bo'lib yoziladi) */
  async updateBranding(organizationId: number, dto: UpdateBrandingDto) {
    const org = await this.organizationRepo.findOne({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Tashkilot topilmadi');

    if (dto.name !== undefined) org.name = dto.name.trim();
    if (dto.logoUrl !== undefined) org.logoUrl = emptyToNull(dto.logoUrl);
    if (dto.faviconUrl !== undefined) {
      org.faviconUrl = emptyToNull(dto.faviconUrl);
    }
    org.brandingUpdatedAt = new Date();

    await this.organizationRepo.save(org);
    return this.getBranding(organizationId);
  }
}

const emptyToNull = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
