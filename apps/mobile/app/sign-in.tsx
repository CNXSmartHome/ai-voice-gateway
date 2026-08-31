import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useSession } from '../src/session/session-context';
import { theme } from '../src/ui/theme';

/**
 * Sign in.
 *
 * A form over `createSessionController`. The failure message comes from
 * `signInFailureMessage`, which gives a wrong password and an unknown address
 * the same wording -- VG-004 refuses to distinguish them so that the API
 * cannot be used to find out which addresses have accounts, and it would be a
 * waste for the app to give that away instead.
 */
export default function SignInScreen() {
  const { state, controller } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (state.status === 'signed_in') {
    return <Redirect href="/" />;
  }

  const busy = state.status === 'signing_in' || state.status === 'loading';
  const error = state.status === 'signed_out' ? state.error : null;
  const canSubmit = !busy && email.trim() !== '' && password !== '';

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <View style={styles.header}>
            <Text style={styles.heading}>AI Voice Gateway</Text>
            <Text style={styles.subheading}>Sign in to add and control your gateways.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              editable={!busy}
              placeholder="you@example.com"
              placeholderTextColor={theme.colors.textMuted}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              editable={!busy}
              onSubmitEditing={() => {
                if (canSubmit) void controller.signIn({ email: email.trim(), password });
              }}
            />
          </View>

          {error === null ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit, busy }}
            disabled={!canSubmit}
            style={[styles.button, canSubmit ? null : styles.buttonDisabled]}
            onPress={() => {
              void controller.signIn({ email: email.trim(), password });
            }}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.accentText} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  body: { flex: 1, justifyContent: 'center', padding: theme.spacing.lg, gap: theme.spacing.md },
  header: { gap: theme.spacing.xs, marginBottom: theme.spacing.md },
  heading: { color: theme.colors.text, fontSize: 26, fontWeight: '700' },
  subheading: { color: theme.colors.textMuted, fontSize: 15, lineHeight: 21 },
  field: { gap: theme.spacing.xs },
  label: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '500' },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    fontSize: 16,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
  },
  error: { color: theme.colors.danger, fontSize: 14, lineHeight: 20 },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    minHeight: 52,
    marginTop: theme.spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: theme.colors.accentText, fontSize: 16, fontWeight: '600' },
});
