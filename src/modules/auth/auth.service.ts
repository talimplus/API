import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { UsersService } from '@/modules/users/users.service';
import { UserRole } from '@/common/enums/user-role.enums';
import { BlacklistService } from '@/modules/blacklist/blacklist.service';
import { RolesService } from '@/modules/roles/roles.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
    private readonly jwtService: JwtService,
    private readonly blacklistService: BlacklistService,
  ) {}

  async register(dto: RegisterAuthDto) {
    const {
      login,
      email,
      password,
      organizationName,
      firstName,
      lastName,
      phone,
    } = dto;
    const effectiveLogin = email || login;
    if (!effectiveLogin) {
      throw new ConflictException("login yoki email bo'lishi kerak");
    }

    const existing = await this.usersService.findByLogin(effectiveLogin);
    if (existing) throw new ConflictException('Email allaqachon mavjud');

    const organization = await this.organizationsService.create({
      name: organizationName,
      isVip: true,
    });

    // Har bir yangi markazga o'z rollari yaratiladi. `admin` — qulflangan
    // (`*` — barcha ruxsatlar), qolganlari keyin erkin tahrirlanadi.
    const roles = await this.rolesService.seedForOrganization(organization);
    const adminRole = roles.find((role) => role.baseRole === UserRole.ADMIN);

    const user = await this.usersService.createAdminUser(
      {
        firstName,
        lastName,
        login: effectiveLogin,
        phone,
        password,
        role: UserRole.ADMIN,
        userRole: adminRole,
      },
      organization,
    );

    return {
      message: 'Tizimga muvaffaqiyatli ro‘yxatdan o‘tildi',
      user: {
        id: user.id,
        role: user.role,
        email: user.login,
      },
    };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmailWithCenterOrg(email);
    if (!user) throw new UnauthorizedException('Foydalanuvchi topilmadi');

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Parol noto‘g‘ri');

    const payload = {
      sub: user.id,
      email: user.login,
      role: user.role,
      roleId: user.userRole?.id ?? null,
      organizationId: user.organization?.id,
    };

    if (user.center?.id) {
      payload['centerId'] = user.center?.id;
    }

    // Ruxsatlar token ichida emas, har safar rol'dan o'qiladi — admin rolni
    // o'zgartirsa, xodim qayta login qilmasdan yangi ruxsatlarni oladi.
    const permissions = await this.rolesService.getPermissionsForUser({
      userId: user.id,
      email: user.login,
      role: user.role,
      organizationId: user.organization?.id,
    });

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.login,
        role: user.role,
        roleId: user.userRole?.id ?? null,
        roleName: user.userRole?.name ?? null,
        centerId: user.center?.id,
        permissions: Array.from(permissions),
      },
    };
  }

  async logout(req: any) {
    const auth = req?.headers?.authorization;
    const token =
      typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice('Bearer '.length).trim()
        : null;

    if (!token) {
      // still return success (frontend can treat as logged out)
      return { success: true };
    }

    const decoded: any = this.jwtService.decode(token);
    const exp = typeof decoded?.exp === 'number' ? decoded.exp : null;
    const expiresAt = exp
      ? new Date(exp * 1000)
      : new Date(Date.now() + 86400000);

    await this.blacklistService.blacklistToken({
      token,
      userId: req?.user?.userId,
      expiresAt,
    });

    return { success: true };
  }

  /**
   * Frontend har sahifa yangilanganda shu yerdan ruxsatlarni oladi —
   * `can('students.create')` tekshiruvlari shu ro'yxatga tayanadi.
   */
  async me(currentUser: any) {
    const { permissions, roleId, roleName } =
      await this.rolesService.getRoleContextForUser(currentUser);

    return {
      user: {
        id: currentUser?.userId,
        email: currentUser?.email,
        role: currentUser?.role,
        roleId,
        roleName,
        centerId: currentUser?.centerId ?? null,
        permissions: Array.from(permissions),
      },
    };
  }
}
