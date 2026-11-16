declare module 'react-native-web' {
  import type { AriaRole, ComponentType, ReactNode } from 'react';

  type Style = Readonly<Record<string, string | number | boolean | object | null | undefined>>;
  type StyleProp = Style | readonly StyleProp[] | false | null | undefined;

  interface ElementProps {
    children?: ReactNode;
    style?: StyleProp;
    accessibilityLabel?: string;
    accessibilityRole?: AriaRole;
    nativeID?: string;
  }

  interface ButtonProps extends ElementProps {
    disabled?: boolean;
    onPress?: () => void;
  }

  export const View: ComponentType<ElementProps>;
  export const Text: ComponentType<ElementProps & { numberOfLines?: number; selectable?: boolean }>;
  export const ScrollView: ComponentType<ElementProps & { contentContainerStyle?: StyleProp; nestedScrollEnabled?: boolean }>;
  export const Pressable: ComponentType<ButtonProps>;
  export const TouchableOpacity: ComponentType<ButtonProps>;
  export const ActivityIndicator: ComponentType<{ color?: string; size?: 'small' | 'large' | number }>;
  export const TextInput: ComponentType<ElementProps & {
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    autoComplete?: string;
    editable?: boolean;
    maxLength?: number;
    onChangeText?: (value: string) => void;
    onSubmitEditing?: () => void;
    placeholder?: string;
    placeholderTextColor?: string;
    secureTextEntry?: boolean;
    value?: string;
  }>;

  export const StyleSheet: {
    create<S extends Record<string, Style>>(styles: S): S;
  };
  export const Linking: {
    openURL(url: string): Promise<void>;
  };
}
