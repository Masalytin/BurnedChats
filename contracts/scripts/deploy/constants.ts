import { Address } from '@ton/core';

/** Zero workchain address — admin ops become permanently unreachable (IMP-TOKSIM-01). */
export const INACCESSIBLE_ADMIN_ADDRESS = new Address(0, Buffer.alloc(32, 0));
