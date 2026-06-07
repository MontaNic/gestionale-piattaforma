import { Controller, Get } from '@nestjs/common';

import { Public } from '@gestionale/auth';

@Controller()
export class AppController {
  @Public()
  @Get()
  root(): string {
    return 'Gestionale Accountant API';
  }
}
