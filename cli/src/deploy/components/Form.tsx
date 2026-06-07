/**
 * Sequential input form for a provider's zod schema. Walks fields one at a time:
 * enums/booleans use the arrow-key SelectList, strings use a text input with the
 * default prefilled. Blank string + Enter accepts the default. On the last field
 * it calls `onComplete` with the collected (raw) values for zod to validate.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { SelectList } from './SelectList.js';
import type { FieldMeta } from '../schema-form.js';

interface FormProps {
  fields: FieldMeta[];
  onComplete: (values: Record<string, unknown>) => void;
}

/** Humanize a camelCase field name → "Camel case". */
function humanize(name: string): string {
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function Form({ fields, onComplete }: FormProps) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [text, setText] = useState('');

  // Nothing to collect — complete immediately (effect runs unconditionally).
  useEffect(() => {
    if (fields.length === 0) onComplete({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fields.length === 0) return null;

  const field = fields[step];

  const advance = (value: unknown) => {
    const next = { ...values, [field.name]: value };
    setValues(next);
    setText('');
    if (step + 1 >= fields.length) {
      onComplete(next);
    } else {
      setStep(step + 1);
    }
  };

  const label = humanize(field.name);
  const defaultHint =
    field.default !== undefined && field.default !== ''
      ? ` (default: ${String(field.default)})`
      : field.required
        ? ' (required)'
        : ' (optional)';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green" bold>
          {`[${step + 1}/${fields.length}] `}
        </Text>
        <Text bold>{label}</Text>
        <Text dimColor>{defaultHint}</Text>
      </Box>

      {field.kind === 'enum' && field.options ? (
        <SelectList
          items={field.options.map((o) => ({ label: o, value: o }))}
          onSelect={(v) => advance(v)}
        />
      ) : field.kind === 'boolean' ? (
        <SelectList
          items={[
            { label: 'No', value: false },
            { label: 'Yes', value: true },
          ]}
          onSelect={(v) => advance(v)}
        />
      ) : (
        <Box>
          <Text color="green">{'▸ '}</Text>
          <TextInput
            value={text}
            onChange={setText}
            onSubmit={(submitted) => {
              const trimmed = submitted.trim();
              // Blank accepts the default (or empty string for optional fields).
              advance(trimmed === '' ? (field.default ?? '') : trimmed);
            }}
            placeholder={
              field.default !== undefined && field.default !== ''
                ? String(field.default)
                : ''
            }
          />
        </Box>
      )}
    </Box>
  );
}
