import React from 'react';
import { Text as RNText } from 'react-native';
import { Input, InputField, InputSlot } from '@/components/ui/input';
import { VStack } from '@/components/ui/vstack';
import { Icon } from '@/components/ui/icon';
import { Check, X } from 'lucide-react-native';

export type FieldTone = 'neutral' | 'ok' | 'error';

export interface AccountFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'email-address';
  /** Show the in-field commit button at all (i.e. the value would change). */
  showAction?: boolean;
  /** Whether that button is usable -- green tick vs grey cross. */
  canCommit?: boolean;
  onCommit?: () => void;
  /** One line under the field. Always occupies its slot, so fields don't
   *  shift vertically as messages come and go. */
  status?: string;
  statusTone?: FieldTone;
}

/**
 * One account field: the input, its in-field commit button, and a fixed slot
 * for its status line.
 *
 * The status line reserves its height even when empty. Without that, a field
 * grows by a line the moment "Checking availability…" appears and everything
 * below jumps -- including the button you were about to tap.
 *
 * The button lives inside the input's border rather than beside it, so the
 * two read as one control. Its two states are deliberately distinguishable
 * by shape as well as colour (tick vs cross), not colour alone -- green and
 * grey are hard to tell apart with the common forms of colour blindness, and
 * "can I submit this?" shouldn't depend on seeing hue.
 */
export default function AccountField({
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  showAction = false,
  canCommit = false,
  onCommit,
  status,
  statusTone = 'neutral',
}: AccountFieldProps) {
  const statusColor =
    statusTone === 'ok'
      ? 'text-green-600'
      : statusTone === 'error'
        ? 'text-pink-600'
        : 'text-gray-400';

  return (
    <VStack className="gap-1.5">
      <Input className="rounded-2xl h-12 pl-4 pr-1.5">
        <InputField
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          className="text-base"
        />
        {showAction && (
          <InputSlot
            onPress={canCommit ? onCommit : undefined}
            disabled={!canCommit}
            className={`w-9 h-9 rounded-xl items-center justify-center ${
              canCommit ? 'bg-lime-500 active:bg-lime-600' : 'bg-gray-300'
            }`}
          >
            <Icon as={canCommit ? Check : X} className="text-white w-4 h-4" />
          </InputSlot>
        )}
      </Input>

      <RNText className={`text-xs px-1 h-4 ${statusColor}`}>{status ?? ''}</RNText>
    </VStack>
  );
}
