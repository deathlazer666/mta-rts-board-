import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mta.rtboard",
  appName: "MTA REAL-TIME",
  webDir: "out",
  android: {
    allowMixedContent: true,
  },
};

export default config;