import { Platform } from 'react-native';

export const LOCAL_MODE_LABEL = Platform.OS === 'android' ? 'Local Mode' : 'Private Mode';
