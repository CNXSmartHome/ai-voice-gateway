import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../src/session/session-context';
import { theme } from '../src/ui/theme';

/**
 * The signed-in home screen.
 *
 * It lists no gateways yet, because adding one is the second half of VG-008
 * and it needs the properties API (#30) before it can claim anything. What it
 * does prove is the part this half is about: a session that survives a
 * restart, and a sign-out that removes it.
 */
export default function HomeScreen() {
  const { state, controller } = useSession();

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.centred}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    );
  }

  if (state.status !== 'signed_in') {
    return <Redirect href="/sign-in" />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.heading}>Signed in</Text>
        <Text style={styles.subheading}>{state.session.email}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>No gateways yet</Text>
          <Text style={styles.cardBody}>
            Adding a VG-100 over Bluetooth arrives with the second half of this task.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => {
            void controller.signOut();
          }}
        >
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  body: { flex: 1, padding: theme.spacing.lg, gap: theme.spacing.md },
  heading: { color: theme.colors.text, fontSize: 24, fontWeight: '600' },
  subheading: { color: theme.colors.textMuted, fontSize: 15 },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  cardTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  cardBody: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  secondaryButton: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryButtonText: { color: theme.colors.textMuted, fontSize: 16, fontWeight: '500' },
});
