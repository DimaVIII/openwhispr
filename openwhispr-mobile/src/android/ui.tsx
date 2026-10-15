import './strings';
import React from 'react';
import {
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { OpenWhisprMark } from '@/components/ui/OpenWhisprMark';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

export const palette = {
  background: '#F8F6F5',
  ink: '#21212B',
  muted: '#66636E',
  blue: '#2457C5',
  soft: '#EAE8FA',
  line: '#E6E1DE',
  white: '#FFFFFF',
};
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.background },
  content: { padding: 24, gap: 20, paddingBottom: 32 },
  title: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '600',
    color: palette.ink,
    letterSpacing: -1.2,
  },
  heading: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '600',
    color: palette.ink,
    letterSpacing: -0.5,
  },
  body: { fontSize: 16, lineHeight: 24, color: palette.muted },
  caption: { fontSize: 13, lineHeight: 19, color: palette.muted },
  card: {
    backgroundColor: palette.white,
    padding: 20,
    borderRadius: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: palette.line,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  button: {
    minHeight: 54,
    borderRadius: 28,
    backgroundColor: palette.blue,
    paddingHorizontal: 22,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
  input: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: palette.line,
    color: palette.ink,
    fontSize: 17,
    minHeight: 56,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
  },
});
export function Button({
  label,
  onPress,
  secondary,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.button,
        secondary && { backgroundColor: palette.soft },
        (disabled || busy) && { opacity: 0.5 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? palette.blue : 'white'} />
      ) : (
        <Text style={[styles.buttonText, secondary && { color: palette.ink }]}>{label}</Text>
      )}
    </Pressable>
  );
}
export function Page({
  title,
  children,
  back = false,
  showAccount = true,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  back?: boolean;
  showAccount?: boolean;
  footer?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <View style={[styles.row, { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16 }]}>
        {back ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            onPress={() => router.back()}
            style={{ padding: 10 }}
          >
            <Text style={{ fontSize: 26 }}>‹</Text>
          </Pressable>
        ) : (
          <OpenWhisprMark size={30} color={palette.blue} />
        )}
        <Text style={{ fontSize: 17, fontWeight: '600', flex: 1 }}>{title}</Text>
        {!back && showAccount && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('account')}
            onPress={() => router.push('/(account)')}
            style={{ borderRadius: 22, backgroundColor: palette.soft, padding: 12 }}
          >
            <Text style={{ color: palette.blue }}>◉</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer && (
        <SafeAreaView
          edges={['bottom']}
          style={{ paddingHorizontal: 24, paddingTop: 12, backgroundColor: palette.background }}
        >
          {footer}
        </SafeAreaView>
      )}
    </SafeAreaView>
  );
}
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Row({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.row, { minHeight: 58, paddingVertical: 10 }]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontSize: 17, color: palette.ink }}>{title}</Text>
        {detail && <Text style={styles.caption}>{detail}</Text>}
      </View>
      <Text style={{ fontSize: 24, color: palette.muted }}>›</Text>
    </Pressable>
  );
}
