import { Text, View } from "react-native";
import { GalleryIcon, PromptsIcon, EchoesIcon, VaultIcon } from "./sceneIcons";

type BottomTabBarProps = {
  active: "gallery" | "prompts" | "echoes" | "vault";
};

// Figma: 1:518 (Nav), 1:519 (Overlay+OverlayBlur)
export function BottomTabBar({ active }: BottomTabBarProps) {
  return (
    <View className="absolute bottom-0 inset-x-0 pb-8 pt-4 px-5 z-30">
      <View className="backdrop-blur-[12px] bg-[rgba(246,243,238,0.9)] flex-row items-center rounded-full shadow-[0px_16px_36px_-8px_rgba(30,27,24,0.12)]" style={{ maxWidth: 384, marginLeft: "auto", marginRight: "auto" }}>
        <TabItem label="Gallery" icon={GalleryIcon} isActive={active === "gallery"} />
        <TabItem label="Prompts" icon={PromptsIcon} isActive={active === "prompts"} />
        <TabItem label="Echoes" icon={EchoesIcon} isActive={active === "echoes"} />
        <TabItem label="Vault" icon={VaultIcon} isActive={active === "vault"} />
      </View>
    </View>
  );
}

function TabItem({ label, icon: Icon, isActive }: { label: string; icon: React.FC; isActive: boolean }) {
  return (
    <View className="flex-col gap-0.5 items-center justify-center min-h-[44px] px-3 py-1">
      <Icon />
      <Text className={`font-sans-semibold text-[11px] leading-[14px] ${isActive ? "text-brand-deep" : "text-ink-soft"}`}>
        {label}
      </Text>
    </View>
  );
}
