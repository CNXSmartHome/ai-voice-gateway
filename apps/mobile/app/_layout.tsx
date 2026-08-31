import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { SessionProvider } from '../src/session/session-context';
import { theme } from '../src/ui/theme';

/**
 * Shown when the bundle has no usable API URL.
 *
 * A build mistake rather than a user one, so it says what is wrong and where
 * to fix it instead of offering a retry that cannot help.
 */
function ConfigurationError({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.errorScreen}>
      <View style={styles.errorBody}>
        <Text style={styles.errorTitle}>The app is not configured</Text>
        <Text style={styles.errorMessage}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider
      renderConfigurationError={(message) => <ConfigurationError message={message} />}
    >
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Gateways' }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
      </Stack>
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  errorBody: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  errorTitle: {
    color: theme.colors.danger,
    fontSize: 20,
    fontWeight: '600',
  },
  errorMessage: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
});
