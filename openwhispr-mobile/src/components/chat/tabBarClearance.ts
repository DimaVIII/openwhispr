import { Platform } from 'react-native';

// Chat's tab screens draw under the native tab bar, so content pinned to the bottom sits this far
// up. Same offset as Fab's.
export const TAB_BAR_CLEARANCE = Platform.OS === 'ios' ? 110 : 70;
