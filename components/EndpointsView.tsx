import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { SettingsGroup, SettingsSubHeader } from '@/components/ui/settings-group';
import {
  Endpoint,
  EndpointUse,
  createEndpoint,
  deleteEndpoint,
  getEndpointToken,
  listEndpoints,
  maskToken,
  setEndpointToken,
  updateEndpoint,
} from '@/lib/plaintext/endpoints';

/**
 * The allow-list of destinations, as a table.
 *
 * One screen for both gates rather than two: an endpoint is the same kind of
 * object either way, and splitting the list would mean the same URL typed
 * twice to serve both. The Use column is what assigns it to a gate.
 *
 * Tokens are write-only here. A saved token renders as its last four
 * characters and is never read back into the field -- there is no reason for
 * a settings screen to put a live credential on screen, and plenty of reasons
 * (screenshots, screen sharing, shoulders) not to.
 */
export function EndpointsView({ onBack }: { onBack: () => void }) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [tokens, setTokens] = useState<Record<string, string | null>>({});

  const refresh = useCallback(async () => {
    const rows = await listEndpoints();
    setEndpoints(rows);
    const entries = await Promise.all(
      rows.map(async (e) => [e.id, await getEndpointToken(e.id)] as const)
    );
    setTokens(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = async (use: EndpointUse) => {
    await createEndpoint(use);
    await refresh();
  };

  const handleDelete = (endpoint: Endpoint) => {
    Alert.alert(
      'Remove this endpoint?',
      `${endpoint.name || 'Untitled'} will be removed along with its token. Nothing further can be sent there.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteEndpoint(endpoint.id);
            await refresh();
          },
        },
      ]
    );
  };

  return (
    <>
      <SettingsSubHeader title="Endpoints" onBack={onBack} />

      <ScrollView className="flex-1 px-5 pt-4 bg-white">
        <SettingsGroup
          caption="Destinations"
          footnote="Decrypted note text is sent only to endpoints listed here, and only for the request that asks for it. Changing a URL asks for your approval again."
        >
          {endpoints.length === 0 ? (
            <View className="px-4 py-3">
              <RNText className="text-sm text-gray-400">No endpoints yet.</RNText>
            </View>
          ) : (
            endpoints.map((endpoint) => (
              <EndpointRow
                key={endpoint.id}
                endpoint={endpoint}
                token={tokens[endpoint.id] ?? null}
                onChanged={refresh}
                onDelete={() => handleDelete(endpoint)}
              />
            ))
          )}
        </SettingsGroup>

        <View className="flex-row gap-3">
          <AddButton label="+ Add AI endpoint" onPress={() => void handleAdd('ai')} />
          <AddButton label="+ Add API endpoint" onPress={() => void handleAdd('api')} />
        </View>

        <View className="h-8" />
      </ScrollView>
    </>
  );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 py-3 rounded-2xl bg-gray-100 items-center active:bg-gray-200"
    >
      <RNText className="text-sm font-medium text-gray-700">{label}</RNText>
    </Pressable>
  );
}

function EndpointRow({
  endpoint,
  token,
  onChanged,
  onDelete,
}: {
  endpoint: Endpoint;
  token: string | null;
  onChanged: () => void | Promise<void>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(endpoint.name);
  const [url, setUrl] = useState(endpoint.url);
  const [newToken, setNewToken] = useState('');

  const commit = useCallback(async () => {
    if (name !== endpoint.name || url !== endpoint.url) {
      await updateEndpoint(endpoint.id, { name, url });
      await onChanged();
    }
  }, [name, url, endpoint.id, endpoint.name, endpoint.url, onChanged]);

  const commitToken = useCallback(async () => {
    if (!newToken) return;
    await setEndpointToken(endpoint.id, newToken);
    setNewToken('');
    await onChanged();
  }, [newToken, endpoint.id, onChanged]);

  // Debounced autosave, not onBlur alone -- ManageAccountDialog.tsx learned
  // this the hard way and it repeated here exactly: moving focus from a field
  // straight onto a button (Back, the delete icon) does not reliably fire
  // onBlur in React Native, so the value is silently discarded. Observed with
  // the token field, which saved nothing at all until this was added.
  //
  // The 600ms is longer than the editor's 300ms on purpose: committing a URL
  // clears this endpoint's approval (see updateEndpoint), so half-typed
  // intermediate values should not each cost a round of consent.
  useEffect(() => {
    const timeout = setTimeout(() => void commit(), 600);
    return () => clearTimeout(timeout);
  }, [commit]);

  useEffect(() => {
    const timeout = setTimeout(() => void commitToken(), 600);
    return () => clearTimeout(timeout);
  }, [commitToken]);

  return (
    <View className="px-4 py-3">
      <View className="flex-row items-center justify-between mb-2">
        <View className="px-2 py-0.5 rounded-md bg-gray-200">
          <RNText className="text-[10px] font-semibold text-gray-600 uppercase">
            {endpoint.use}
          </RNText>
        </View>
        <View className="flex-row items-center gap-3">
          {endpoint.confirmedAt ? (
            <RNText className="text-[10px] text-gray-400 uppercase">Approved</RNText>
          ) : (
            <RNText className="text-[10px] text-amber-500 uppercase">Not approved</RNText>
          )}
          <Pressable onPress={onDelete} className="p-1 active:opacity-60">
            <Icon as={Trash2} className="w-4 h-4 text-red-400" />
          </Pressable>
        </View>
      </View>

      <Field value={name} onChangeText={setName} onBlur={commit} placeholder="Untitled" />
      <Field
        value={url}
        onChangeText={setUrl}
        onBlur={commit}
        placeholder="https://api.example.com/v1"
        autoCapitalize="none"
        keyboardType="url"
      />

      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Field
            value={newToken}
            onChangeText={setNewToken}
            onBlur={commitToken}
            placeholder={token ? maskToken(token) : 'Token'}
            autoCapitalize="none"
            secureTextEntry
            last
          />
        </View>
      </View>
    </View>
  );
}

function Field({
  last,
  ...props
}: React.ComponentProps<typeof TextInput> & { last?: boolean }) {
  return (
    <TextInput
      {...props}
      autoCorrect={false}
      spellCheck={false}
      placeholderTextColor="#9CA3AF"
      className={`border border-gray-200 rounded-xl h-10 px-3 text-sm text-gray-900 bg-white ${
        last ? '' : 'mb-2'
      }`}
    />
  );
}
