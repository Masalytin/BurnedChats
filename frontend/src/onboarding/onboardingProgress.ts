/**
 * Client-only onboarding step progress (localStorage).
 * Key: bc:onboarding:v1 — not a UserPreferences field, not CloudStorage.
 */

export type OnboardingStepId = 'briefing' | 'homeTour' | 'createRoomHint';

export interface OnboardingProgress {
  v: 1;
  seen: Partial<Record<OnboardingStepId, true>>;
}

export const ONBOARDING_STORAGE_KEY = 'bc:onboarding:v1';
export const LEGACY_ONBOARDING_SEEN_KEY = 'bc:onboarding-seen';

const STEP_IDS: readonly OnboardingStepId[] = ['briefing', 'homeTour', 'createRoomHint'];

function emptyProgress(): OnboardingProgress {
  return { v: 1, seen: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateProgress(value: unknown): OnboardingProgress {
  if (!isRecord(value) || value.v !== 1) {
    return emptyProgress();
  }

  const seen: Partial<Record<OnboardingStepId, true>> = {};
  if (isRecord(value.seen)) {
    for (const id of STEP_IDS) {
      if (value.seen[id] === true) {
        seen[id] = true;
      }
    }
  }
  return { v: 1, seen };
}

function writeProgress(progress: OnboardingProgress): boolean {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

function migrateLegacySeen(): OnboardingProgress {
  try {
    if (localStorage.getItem(LEGACY_ONBOARDING_SEEN_KEY) !== '1') {
      return emptyProgress();
    }
  } catch {
    return emptyProgress();
  }

  const migrated: OnboardingProgress = { v: 1, seen: { briefing: true } };
  if (writeProgress(migrated)) {
    try {
      localStorage.removeItem(LEGACY_ONBOARDING_SEEN_KEY);
    } catch {
      // Ignore private-mode / storage errors after a successful write
    }
  }
  return migrated;
}

export function loadOnboardingProgress(): OnboardingProgress {
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (raw) {
      return validateProgress(JSON.parse(raw));
    }
    return migrateLegacySeen();
  } catch {
    return emptyProgress();
  }
}

export function saveOnboardingProgress(progress: OnboardingProgress): void {
  writeProgress(progress);
}

export function markOnboardingSeen(id: OnboardingStepId): OnboardingProgress {
  const current = loadOnboardingProgress();
  const next: OnboardingProgress = {
    v: 1,
    seen: { ...current.seen, [id]: true },
  };
  saveOnboardingProgress(next);
  return next;
}

export function resetOnboardingProgress(): void {
  saveOnboardingProgress(emptyProgress());
}
