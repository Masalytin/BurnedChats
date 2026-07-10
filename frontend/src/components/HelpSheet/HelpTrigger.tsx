import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import './HelpSheet.css';

export interface HelpTriggerProps {
  /** Opens the parent-controlled HelpSheet. */
  onOpen: () => void;
  /** Optional accessible label; defaults to `help.common.trigger`. */
  label?: string;
}

/**
 * Compact “what is this?” control for contextual help next to a screen title or field.
 */
export function HelpTrigger({ onOpen, label }: HelpTriggerProps) {
  const { t } = useTranslation();
  const ariaLabel = label ?? t('help.common.trigger');

  return (
    <button
      type="button"
      className="help-trigger-btn"
      onClick={onOpen}
      aria-label={ariaLabel}
    >
      <CircleHelp size={18} strokeWidth={2.2} aria-hidden />
      <span className="help-trigger-label">{ariaLabel}</span>
    </button>
  );
}
