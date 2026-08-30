import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mta.rtboard",
  appName: "MTA RT Board",
  webDir: "out",
  android: {
    allowMixedContent: true,
  },
};

export default config;