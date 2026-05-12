import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import type { HealthDto } from './health.dto';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  async check(): Promise<HealthDto> {
    const dto = await this.health.check();
    // Pattern production: status code semantico per orchestrator (k8s
    // liveness/readiness, load balancer health check). Body identico in
    // entrambi i casi per parsing client-side uniforme.
    if (dto.status === 'degraded') {
      throw new ServiceUnavailableException(dto);
    }
    return dto;
  }
}
