import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Center } from './entities/centers.entity';
import { CreateCenterDto } from './dto/create-center.dto';
import { UpdateCenterDto } from './dto/update-center.dto';
import { Organization } from '@/modules/organizations/entities/organizations.entity';

@Injectable()
export class CentersService {
  constructor(
    @InjectRepository(Center)
    private readonly centerRepo: Repository<Center>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
  ) {}

  async create(dto: CreateCenterDto, organizationId: number) {
    const organization = await this.orgRepo.findOneBy({ id: organizationId });
    if (!organization) {
      throw new NotFoundException('Organization topilmadi');
    }

    return this.centerRepo.manager.transaction(async (manager) => {
      const centerRepo = manager.getRepository(Center);

      // If org has no centers yet, first one becomes default unless explicitly false.
      const existingCount = await centerRepo.count({
        where: { organization: { id: organizationId } as any },
      });
      const shouldBeDefault =
        dto.isDefault === true || (existingCount === 0 && dto.isDefault !== false);

      if (shouldBeDefault) {
        await centerRepo
          .createQueryBuilder()
          .update(Center)
          .set({ isDefault: false })
          .where('"organizationId" = :organizationId', { organizationId })
          .execute();
      }

      const center = centerRepo.create({
        name: dto.name,
        isDefault: shouldBeDefault,
        organization,
        organizationId: organizationId as any,
      });

      return centerRepo.save(center);
    });
  }

  async findAll(
    organizationId: number,
    {
      page = 1,
      perPage = 10,
      name,
    }: {
      page?: number;
      perPage?: number;
      name?: string;
    },
  ) {
    const skip = (page - 1) * perPage;

    const query = this.centerRepo
      .createQueryBuilder('center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (name) {
      query.andWhere('center.name ILIKE :name', { name: `%${name}%` });
    }

    const [data, total] = await query
      .orderBy('center.isDefault', 'DESC')
      .addOrderBy('center.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async getAllByCenters(organizationId: number): Promise<Center[]> {
    return this.centerRepo.find({
      where: {
        organization: { id: organizationId },
      },
      order: {
        isDefault: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: number) {
    const center = await this.centerRepo.findOne({
      where: { id },
    });

    if (!center) {
      throw new NotFoundException('Filial topilmadi');
    }

    return center;
  }

  async update(id: number, dto: UpdateCenterDto) {
    return this.centerRepo.manager.transaction(async (manager) => {
      const centerRepo = manager.getRepository(Center);

      const center = await centerRepo.findOne({ where: { id } });
      if (!center) throw new NotFoundException('Filial topilmadi');
      const organizationId = (center as any).organizationId as number | null;
      if (!organizationId) {
        throw new BadRequestException('Center organizationId is missing');
      }

      if (dto.isDefault === true) {
        await centerRepo
          .createQueryBuilder()
          .update(Center)
          .set({ isDefault: false })
          .where('"organizationId" = :organizationId', { organizationId })
          .execute();
        center.isDefault = true;
      }

      if (dto.isDefault === false && center.isDefault) {
        // Do not allow leaving org without any default center
        const otherDefault = await centerRepo.findOne({
          where: {
            organizationId: organizationId as any,
            isDefault: true,
          } as any,
        });
        // otherDefault will be 'center' itself right now; we only allow disabling if another center is already default
        if (!otherDefault || otherDefault.id === center.id) {
          throw new BadRequestException(
            'Organization must have a default center',
          );
        }
        center.isDefault = false;
      }

      if (dto.name !== undefined) center.name = dto.name;

      return centerRepo.save(center);
    });
  }

  async remove(id: number) {
    const center = await this.findOne(id);
    return this.centerRepo.remove(center);
  }
}
