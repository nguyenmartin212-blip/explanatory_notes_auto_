import { AppButton } from '@/components';

type Props = {
  poiName: string;
  onPress?: () => void;
};

export function NarrationButton({ poiName, onPress }: Props) {
  return <AppButton label={`▶ Kể chuyện về ${poiName}`} onPress={onPress} />;
}
