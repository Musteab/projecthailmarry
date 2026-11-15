import { triage } from '../triage';
import { explain, narrate } from '../narrative';
import type { IntelPort } from '@bastion/shared';
import { fuse } from '../fusion';
import { IntelService } from './service';
import type { IntelConfig } from './service';
export function createIntel(config: IntelConfig = {}): IntelPort {
  const service = new IntelService(config);
  return {
    fuse: (signals, ctx) => fuse(service, signals, ctx),
    triage: (call, ctx) => triage(service, call, ctx),
    explain: (action) => explain(service, action),
    narrateRestoration: (analysis) => narrate(service, analysis),
  };
}
