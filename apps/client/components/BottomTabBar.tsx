import { Text, View } from "react-native";
import { GalleryIcon, PromptsIcon, EchoesIcon, VaultIcon } from "./sceneIcons";

type BottomTabBarProps = {
  active: "gallery" | "prompts" | "echoes" | "vault";
};

// Figma: 1:518 (Nav), 1:519 (Overlay+OverlayBlur)
export function BottomTabBar({ active }: BottomTabBarProps) {
  return (
    <View className="absolute bottom-0 inset-x-0 z-30">
      <View className="px-4 pb-2 pt-1">
        <View className="h-16 w-full flex-row items-center gap-[31.5px] rounded-full bg-surface-raised/90 px-4 backdrop-blur-[12px] shadow-[0px_16px_36px_-8px_rgba(30,27,24,0.12)]">
          <TabItem label="Gallery" icon={GalleryIcon} isActive={active === "gallery"} />
          <TabItem label="Prompts" icon={PromptsIcon} isActive={active === "prompts"} />
          <TabItem label="Echoes" icon={EchoesIcon} isActive={active === "echoes"} />
          <TabItem label="Vault" icon={VaultIcon} isActive={active === "vault"} />
        </View>
      </View>
    </View>
  );
}

function TabItem({ label, icon: Icon, isActive }: { label: string; icon: React.FC; isActive: boolean }) {
  return (
    <View className="min-h-[44px] min-w-[48px] flex-col items-center justify-center gap-0.5 py-[3px]">
      <Icon />
      <Text className={`font-sans-semibold text-[11px] leading-[14px] ${isActive ? "text-action" : "text-ink-muted"}`}>
        {label}
      </Text>
    </View>
  );
}
