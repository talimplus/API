import { Controller, Post, Body, Req, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { Public } from '@/decorators/public.decorator';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiBody({ type: RegisterAuthDto })
  register(@Body() dto: RegisterAuthDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @ApiBody({ type: LoginAuthDto })
  login(@Body() dto: LoginAuthDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('logout')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Logout (invalidate current access token)',
    description:
      'For stateless JWT, logout typically means client deletes the token. This endpoint additionally blacklists the current access token server-side until it expires.',
  })
  @ApiResponse({ schema: { example: { success: true } } })
  logout(@Req() req: any) {
    return this.authService.logout(req);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get current user (me)',
    description:
      'Returns current authenticated user info (same shape as login.user), without issuing a new token.',
  })
  @ApiResponse({
    schema: {
      example: {
        user: { id: 1, email: 'admin@example.com', role: 'admin', centerId: 2 },
      },
    },
  })
  me(@Req() req: any) {
    return this.authService.me(req.user);
  }
}
