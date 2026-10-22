import { StyleSheet, View } from 'react-native';
import { OpenWhisprMark } from '@/components/ui/OpenWhisprMark';

export function ChatWatermark(): React.JSX.Element {
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      className="items-center justify-center"
    >
      <OpenWhisprMark size={132} color="rgba(17,17,19,0.07)" />
    </View>
  );
}
