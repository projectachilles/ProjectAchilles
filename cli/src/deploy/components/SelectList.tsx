/**
 * Minimal arrow-key selector. Built on Ink's core `useInput` so we avoid adding
 * the `ink-select-input` dependency (keeps "no new toolchain"). Up/down (or k/j)
 * move the cursor; Enter selects.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SelectItem<T> {
  label: string;
  value: T;
  /** Optional dim description shown after the label. */
  description?: string;
}

interface SelectListProps<T> {
  items: SelectItem<T>[];
  onSelect: (value: T) => void;
}

export function SelectList<T>({ items, onSelect }: SelectListProps<T>) {
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setIndex((i) => (i - 1 + items.length) % items.length);
    } else if (key.downArrow || input === 'j') {
      setIndex((i) => (i + 1) % items.length);
    } else if (key.return) {
      const item = items[index];
      if (item) onSelect(item.value);
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const active = i === index;
        return (
          <Box key={`opt-${i}`}>
            <Text color={active ? 'green' : undefined} bold={active}>
              {active ? '❯ ' : '  '}
              {item.label}
            </Text>
            {item.description ? (
              <Text dimColor>{`  — ${item.description}`}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
