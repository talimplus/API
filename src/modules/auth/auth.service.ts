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

@Injectable()
export class AuthService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterAuthDto) {
    const { email, password, organizationName, firstName, lastName, phone } =
      dto;

    const existing = await this.usersService.findByEmail(email);
    if (existing) throw new ConflictException('Email allaqachon mavjud');

    const organization = await this.organizationsService.create({
      name: organizationName,
      isVip: true,
    });

    const user = await this.usersService.createAdminUser(
      {
        firstName,
        lastName,
        email,
        phone,
        password,
        role: UserRole.ADMIN,
      },
      organization,
    );

    return {
      message: 'Tizimga muvaffaqiyatli ro‘yxatdan o‘tildi',
      user: {
        id: user.id,
        role: user.role,
        email: user.email,
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
      email: user.email,
      role: user.role,
      organizationId: user.organization?.id,
    };

    if (user.center?.id) {
      payload['centerId'] = user.center?.id;
    }

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        centerId: user.center?.id,
      },
    };
  }
}
