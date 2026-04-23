/** Minimal typings: jest-axe ships no types; @types/jest-axe pulls a heavy @types/jest tree. */
declare module 'jest-axe' {
  export interface AxeRunResults {
    readonly violations: readonly unknown[];
  }

  /** Default axe instance from `configureAxe()`. */
  export const axe: (
    html: Element | string,
    additionalOptions?: Record<string, unknown>
  ) => Promise<AxeRunResults>;

  export function configureAxe(
    options?: Record<string, unknown>
  ): typeof axe;

  export const toHaveNoViolations: Record<string, unknown>;
}
