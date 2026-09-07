import { Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@vg/domain';

import type { AdapterCommand, AdapterResult, SmartHomeAdapter } from '../adapter.port';

/**
 * A Home Assistant adapter that talks to nothing (VG-040).
 *
 * It exists to hold the boundary open, not to control anything. A registry
 * with a single platform in it cannot demonstrate provider independence: any
 * Tuya assumption that leaked into the pipeline would still pass every test,
 * because there would be no second platform for it to be wrong about. This
 * adapter is that second platform.
 *
 * It deliberately performs no I/O. Real Home Assistant support -- a base URL,
 * a long-lived access token, entity-domain mapping -- is a platform adapter
 * of its own and DUAL_AI_REVIEW under `AI_GOVERNANCE.md`. Shipping a
 * half-configured HTTP client here would be that task, done badly, inside a
 * task about abstraction.
 */
@Injectable()
export class HomeAssistantStubAdapter implements SmartHomeAdapter {
  readonly platform: Platform = 'home_assistant';

  private readonly logger = new Logger(HomeAssistantStubAdapter.name);

  /** Commands accepted, in order. Lets a test assert what reached the boundary. */
  readonly dispatched: AdapterCommand[] = [];

  execute(command: AdapterCommand): Promise<AdapterResult> {
    this.dispatched.push(command);

    // The entity id is a provider identifier. It is logged at debug and never
    // at info, for the same reason the gateway's proof of possession is never
    // logged at all: logs travel further than the process that wrote them.
    this.logger.debug(`home_assistant stub accepted ${command.capability}`);

    return Promise.resolve({ ok: true });
  }
}
