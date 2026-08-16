import { useState, useEffect } from "react";
import { Platform, Dimensions } from "react-native";
import * as Device from "expo-device";

// R2.1: tablet detection — primary: expo-device deviceType; fallback (UNKNOWN/null
// or API failure): shortest window side >= 600dp (standard Android sw600dp breakpoint).
export function useIsTablet(): boolean {
  const [isTablet, setIsTablet] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const bySize = () => {
      const { width, height } = Dimensions.get("window");
      return Math.min(width, height) >= 600;
    };
    Device.getDeviceTypeAsync()
      .then((dt) => {
        if (dt === Device.DeviceType.TABLET) setIsTablet(true);
        else if (dt === Device.DeviceType.PHONE) setIsTablet(false);
        else setIsTablet(bySize());
      })
      .catch(() => setIsTablet(bySize()));
  }, []);
  return isTablet;
}
