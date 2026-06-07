import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';

import { CurrentUser, UsersService } from '@gestionale/auth';
import type { AuthenticatedUser, FullProfile } from '@gestionale/auth';

@Controller('me')
export class MeController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() user: AuthenticatedUser | undefined): Promise<{ data: FullProfile }> {
    // JwtAuthGuard globale assicura user presente; check defensive.
    if (!user) throw new NotFoundException('E_USER_NOT_FOUND');
    const profile = await this.users.findFullProfile(user.id);
    if (!profile) throw new NotFoundException('E_USER_NOT_FOUND');
    return { data: profile };
  }
}
