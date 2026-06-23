import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../Input/Input';
import {
  parseDurationInputValue,
  sanitizeDurationInput,
  secondsToBestUnit,
  unitToSeconds,
  validateDurationSeconds,
  type DurationUnit,
  type DurationValidationResult,
} from '../../utils/duration';
import './DurationField.css';

const DEFAULT_UNITS: DurationUnit[] = ['minute', 'hour', 'day'];

const UNIT_I18N_KEYS: Record<DurationUnit, string> = {
  minute: 'common.duration.unitMinutes',
  hour: 'common.duration.unitHours',
  day: 'common.duration.unitDays',
};

export interface DurationFieldProps {
  valueSeconds: number | null;
  onChange: (seconds: number | null) => void;
  minSeconds: number;
  maxSeconds: number;
  units?: DurationUnit[];
  label: string;
  id?: string;
  disabled?: boolean;
}

function formatDisplayNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(value);
}

function formatBoundLabel(
  seconds: number,
  t: (key: string) => string
): string {
  const { value, unit } = secondsToBestUnit(seconds);
  return `${formatDisplayNumber(value)} ${t(UNIT_I18N_KEYS[unit])}`;
}

function initialFieldState(
  valueSeconds: number | null,
  units: DurationUnit[],
  minSeconds: number,
  maxSeconds: number
): {
  inputText: string;
  selectedUnit: DurationUnit;
  validation: DurationValidationResult;
} {
  if (valueSeconds === null) {
    return { inputText: '', selectedUnit: units[0] ?? 'minute', validation: 'empty' };
  }

  const { value, unit } = secondsToBestUnit(valueSeconds);
  return {
    inputText: formatDisplayNumber(value),
    selectedUnit: units.includes(unit) ? unit : units[0] ?? 'minute',
    validation: validateDurationSeconds(valueSeconds, { min: minSeconds, max: maxSeconds }),
  };
}

export function DurationField({
  valueSeconds,
  onChange,
  minSeconds,
  maxSeconds,
  units = DEFAULT_UNITS,
  label,
  id,
  disabled = false,
}: DurationFieldProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const [fieldState, setFieldState] = useState(() =>
    initialFieldState(valueSeconds, units, minSeconds, maxSeconds)
  );
  const { inputText, selectedUnit, validation } = fieldState;

  const lastExternalValue = useRef<number | null | undefined>(undefined);

  const resolveValidation = useCallback(
    (parsedValue: number | null, seconds: number | null): DurationValidationResult => {
      if (parsedValue === null) {
        return 'empty';
      }
      if (Number.isNaN(parsedValue)) {
        return 'nan';
      }
      return validateDurationSeconds(seconds, { min: minSeconds, max: maxSeconds });
    },
    [minSeconds, maxSeconds]
  );

  const emitFromParts = useCallback(
    (text: string, unit: DurationUnit) => {
      const parsedValue = parseDurationInputValue(text);
      const seconds =
        parsedValue === null || Number.isNaN(parsedValue)
          ? null
          : unitToSeconds(parsedValue, unit);
      const nextValidation = resolveValidation(parsedValue, seconds);
      setFieldState((prev) => ({ ...prev, validation: nextValidation }));
      onChange(nextValidation === 'ok' ? seconds : null);
    },
    [onChange, resolveValidation]
  );

  useEffect(() => {
    if (lastExternalValue.current === valueSeconds) {
      return;
    }
    lastExternalValue.current = valueSeconds;
    setFieldState(initialFieldState(valueSeconds, units, minSeconds, maxSeconds));
  }, [valueSeconds, units, minSeconds, maxSeconds]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeDurationInput(event.target.value);
    setFieldState((prev) => ({ ...prev, inputText: sanitized }));
    emitFromParts(sanitized, selectedUnit);
  };

  const handleUnitSelect = (unit: DurationUnit) => {
    if (disabled || unit === selectedUnit) {
      return;
    }
    setFieldState((prev) => ({ ...prev, selectedUnit: unit }));
    emitFromParts(inputText, unit);
  };

  const errorMessage = (() => {
    switch (validation) {
      case 'empty':
        return inputText.trim() === '' ? t('common.duration.errorEmpty') : undefined;
      case 'nan':
        return t('common.duration.errorNaN');
      case 'below-min':
        return t('common.duration.errorBelowMin', {
          min: formatBoundLabel(minSeconds, t),
        });
      case 'above-max':
        return t('common.duration.errorAboveMax', {
          max: formatBoundLabel(maxSeconds, t),
        });
      default:
        return undefined;
    }
  })();

  return (
    <div className="duration-field">
      <div className="duration-field__controls">
        <Input
          id={fieldId}
          label={label}
          type="text"
          inputMode="numeric"
          value={inputText}
          onChange={handleInputChange}
          disabled={disabled}
          error={errorMessage}
          fullWidth={false}
          className="duration-field__input"
        />
        <div className="duration-field__units" role="group" aria-label={label}>
          {units.map((unit) => {
            const isActive = unit === selectedUnit;
            return (
              <button
                key={unit}
                type="button"
                className={`duration-field__unit-chip${isActive ? ' duration-field__unit-chip--active' : ''}`}
                aria-pressed={isActive}
                disabled={disabled}
                onClick={() => handleUnitSelect(unit)}
              >
                {t(UNIT_I18N_KEYS[unit])}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
