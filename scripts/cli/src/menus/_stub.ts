import * as p from '@clack/prompts';
import pc from 'picocolors';

export async function showStub(cardId: string): Promise<void> {
  p.log.warn(pc.yellow(`[not yet implemented — see ${cardId}]`));
}
