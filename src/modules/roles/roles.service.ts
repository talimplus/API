import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Organization } from '@/modules/organizations/entities/organizations.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { CurrentUser } from '@/common/types/current.user';
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
} from '@/common/permissions/permission.catalog';
import {
  SYSTEM_ROLE_PRESETS,
  getPresetByBaseRole,
} from '@/common/permissions/role.presets';
import { ASSIGNABLE_BASE_ROLES, CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

/** Ruxsatlar keshi: har bir so'rovda DB ga bormaslik uchun (rol o'zgarsa tozalanadi). */
const PERMISSION_CACHE_TTL_MS = 15_000;

interface RoleContext {
  permissions: Set<string>;
  roleId: number | null;
  roleName: string | null;
}

interface CachedRoleContext extends RoleContext {
  expiresAt: number;
}

@Injectable()
export class RolesService {
  private readonly permissionCache = new Map<number, CachedRoleContext>();

  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ───────────────────────────── Katalog ─────────────────────────────

  /** Frontend checkbox'lari uchun to'liq ruxsatlar katalogi. */
  getPermissionCatalog() {
    return PERMISSION_GROUPS;
  }

  // ───────────────────────────── Seed ─────────────────────────────

  /**
   * Yangi organization uchun boshlang'ich rollarni yaratadi.
   * Registratsiyada chaqiriladi; qayta chaqirilsa mavjudlarini qaytaradi.
   */
  async seedForOrganization(organization: Organization): Promise<Role[]> {
    const existing = await this.roleRepo.find({
      where: { organization: { id: organization.id } },
    });
    if (existing.length > 0) return existing;

    const roles = SYSTEM_ROLE_PRESETS.map((preset) =>
      this.roleRepo.create({
        key: preset.key,
        name: preset.name.uz,
        baseRole: preset.baseRole,
        permissions: preset.permissions,
        isSystem: true,
        isLocked: preset.locked,
        organization,
      }),
    );

    return this.roleRepo.save(roles);
  }

  /** Organizationning `admin` roli (registratsiyada egasiga biriktiriladi). */
  async findAdminRole(organizationId: number): Promise<Role | null> {
    return this.roleRepo.findOne({
      where: {
        organization: { id: organizationId },
        baseRole: UserRole.ADMIN,
      },
    });
  }

  /**
   * Eski `role` (enum) bo'yicha organizationning tizim rolini topadi.
   * Xodim yaratishda `roleId` yuborilmagan bo'lsa ishlatiladi.
   */
  async findSystemRoleByBaseRole(
    organizationId: number,
    baseRole: UserRole,
  ): Promise<Role | null> {
    return this.roleRepo.findOne({
      where: {
        organization: { id: organizationId },
        baseRole,
        isSystem: true,
      },
    });
  }

  // ───────────────────────────── CRUD ─────────────────────────────

  /** Organizationdagi barcha rollar + har biriga biriktirilgan xodimlar soni. */
  async findAll(organizationId: number) {
    const roles = await this.roleRepo.find({
      where: { organization: { id: organizationId } },
      order: { id: 'ASC' },
    });

    if (roles.length === 0) return [];

    const counts = await this.userRepo
      .createQueryBuilder('user')
      .select('role.id', 'roleId')
      .addSelect('COUNT(user.id)', 'count')
      .innerJoin('user.userRole', 'role')
      .where('role.id IN (:...roleIds)', { roleIds: roles.map((r) => r.id) })
      .groupBy('role.id')
      .getRawMany<{ roleId: number; count: string }>();

    const countByRole = new Map(
      counts.map((row) => [Number(row.roleId), Number(row.count)]),
    );

    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      baseRole: role.baseRole,
      permissions: role.permissions ?? [],
      isSystem: role.isSystem,
      isLocked: role.isLocked,
      userCount: countByRole.get(role.id) ?? 0,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));
  }

  /** Organization ichidagi rolni id bo'yicha oladi (boshqa markazniki — 404). */
  async findOneInOrganization(
    id: number,
    organizationId: number,
  ): Promise<Role> {
    const role = await this.roleRepo.findOne({
      where: { id, organization: { id: organizationId } },
    });
    if (!role) throw new NotFoundException('Rol topilmadi');
    return role;
  }

  async create(dto: CreateRoleDto, organizationId: number) {
    this.assertAssignableBaseRole(dto.baseRole);

    const key = await this.buildUniqueKey(dto.key || dto.name, organizationId);

    const role = this.roleRepo.create({
      key,
      name: dto.name.trim(),
      baseRole: dto.baseRole,
      permissions: this.normalizePermissions(dto.permissions),
      isSystem: false,
      isLocked: false,
      organization: { id: organizationId } as Organization,
    });

    const saved = await this.roleRepo.save(role);
    this.invalidateCache();
    return saved;
  }

  async update(id: number, dto: UpdateRoleDto, organizationId: number) {
    const role = await this.findOneInOrganization(id, organizationId);

    if (role.isLocked) {
      throw new ForbiddenException(
        'Administrator rolini o‘zgartirib bo‘lmaydi — unda barcha ruxsatlar bor',
      );
    }

    if (dto.name !== undefined) {
      role.name = dto.name.trim();
    }

    if (dto.permissions !== undefined) {
      role.permissions = this.normalizePermissions(dto.permissions);
    }

    if (dto.baseRole !== undefined && dto.baseRole !== role.baseRole) {
      if (role.isSystem) {
        throw new BadRequestException(
          'Tizim rolining turini o‘zgartirib bo‘lmaydi',
        );
      }
      this.assertAssignableBaseRole(dto.baseRole);
      role.baseRole = dto.baseRole;

      // `users.role` har doim rol turi bilan sinxron turishi kerak
      await this.userRepo.update(
        { userRole: { id: role.id } },
        { role: dto.baseRole },
      );
    }

    const saved = await this.roleRepo.save(role);
    this.invalidateCache();
    return saved;
  }

  async remove(id: number, organizationId: number) {
    const role = await this.findOneInOrganization(id, organizationId);

    if (role.isLocked || role.isSystem) {
      throw new ForbiddenException('Tizim rolini o‘chirib bo‘lmaydi');
    }

    const userCount = await this.userRepo.count({
      where: { userRole: { id: role.id } },
    });
    if (userCount > 0) {
      throw new BadRequestException(
        `Bu rolda ${userCount} ta xodim bor. Avval ularga boshqa rol bering.`,
      );
    }

    await this.roleRepo.remove(role);
    this.invalidateCache();
    return { message: 'Rol o‘chirildi' };
  }

  // ─────────────────────── Xodimga rol biriktirish ───────────────────────

  /**
   * Xodim yaratish/tahrirlashda rolni aniqlaydi.
   * `roleId` ustuvor; bo'lmasa eski `role` (enum) bo'yicha tizim roli olinadi.
   */
  async resolveRoleForUser(
    organizationId: number,
    roleId?: number,
    baseRole?: UserRole,
  ): Promise<Role> {
    if (roleId) {
      const role = await this.findOneInOrganization(roleId, organizationId);
      if (role.baseRole === UserRole.ADMIN) {
        throw new BadRequestException(
          'Administrator roli faqat markaz egasiga tegishli',
        );
      }
      return role;
    }

    if (baseRole) {
      const role = await this.findSystemRoleByBaseRole(
        organizationId,
        baseRole,
      );
      if (role) return role;
    }

    throw new BadRequestException('Rol tanlanmagan');
  }

  // ───────────────────────── Ruxsat tekshiruvi ─────────────────────────

  /** Foydalanuvchining barcha ruxsat kalitlari (`*` — hammasi). */
  async getPermissionsForUser(user: CurrentUser): Promise<Set<string>> {
    const { permissions } = await this.getRoleContextForUser(user);
    return permissions;
  }

  /**
   * Foydalanuvchining roli va ruxsatlari (`/auth/me` va login javobi uchun).
   * Ruxsatlar token ichida saqlanmaydi — shuning uchun admin rolni
   * o'zgartirsa, xodim qayta login qilmasdan yangi ruxsatlarni oladi.
   */
  async getRoleContextForUser(user: CurrentUser): Promise<RoleContext> {
    // Platforma darajasidagi super admin — har doim to'liq ruxsat
    if (user.role === UserRole.SUPER_ADMIN) {
      return {
        permissions: new Set([ALL_PERMISSIONS]),
        roleId: null,
        roleName: null,
      };
    }

    const cached = this.permissionCache.get(user.userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const row = await this.userRepo.findOne({
      where: { id: user.userId },
      relations: ['userRole'],
      select: { id: true, role: true },
    });

    let permissions: string[];

    if (row?.userRole) {
      permissions = row.userRole.permissions ?? [];
    } else {
      // Migratsiyadan oldin yaratilgan (roli biriktirilmagan) userlar uchun zaxira
      permissions =
        getPresetByBaseRole(row?.role ?? user.role)?.permissions ?? [];
    }

    const context: RoleContext = {
      permissions: new Set(permissions),
      roleId: row?.userRole?.id ?? null,
      roleName: row?.userRole?.name ?? null,
    };

    this.permissionCache.set(user.userId, {
      ...context,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    });

    return context;
  }

  /** Kerakli kalitlardan **bittasi** bo'lsa ham yetarli (OR). */
  async userHasPermission(
    user: CurrentUser,
    required: string[],
  ): Promise<boolean> {
    const permissions = await this.getPermissionsForUser(user);
    if (permissions.has(ALL_PERMISSIONS)) return true;
    return required.some((key) => permissions.has(key));
  }

  /** Rol/xodim o'zgarganda keshni tozalaymiz. */
  invalidateCache(userId?: number): void {
    if (userId) {
      this.permissionCache.delete(userId);
      return;
    }
    this.permissionCache.clear();
  }

  // ───────────────────────────── Ichki ─────────────────────────────

  private assertAssignableBaseRole(baseRole: UserRole): void {
    if (!ASSIGNABLE_BASE_ROLES.includes(baseRole)) {
      throw new BadRequestException(
        `Rol turi faqat quyidagilardan biri bo‘lishi mumkin: ${ASSIGNABLE_BASE_ROLES.join(', ')}`,
      );
    }
  }

  /** `*` ni hech qachon qabul qilmaymiz — u faqat seed qilingan admin rolida. */
  private normalizePermissions(permissions: string[]): string[] {
    return Array.from(
      new Set(permissions.filter((key) => key !== ALL_PERMISSIONS)),
    );
  }

  /** Nomdan slug yasab, organization ichida unikal qiladi: `kassir`, `kassir-2`, ... */
  private async buildUniqueKey(
    source: string,
    organizationId: number,
  ): Promise<string> {
    const base = slugify(source) || 'role';

    const taken = await this.roleRepo.find({
      where: {
        organization: { id: organizationId },
        key: In([base, ...range(2, 50).map((n) => `${base}-${n}`)]),
      },
      select: { id: true, key: true },
    });

    const takenKeys = new Set(taken.map((r) => r.key));
    if (!takenKeys.has(base)) return base;

    for (const n of range(2, 50)) {
      const candidate = `${base}-${n}`;
      if (!takenKeys.has(candidate)) return candidate;
    }

    return `${base}-${Date.now()}`;
  }
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Kirill/lotin nomdan URL-xavfsiz slug. */
const CYRILLIC_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function slugify(source: string): string {
  return source
    .toLowerCase()
    .trim()
    .replace(/[Ѐ-ӿ]/g, (char) => CYRILLIC_MAP[char] ?? '')
    .replace(/[‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
