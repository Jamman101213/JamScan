import { HEADER_LEN } from "./protocol.js";

export const TRANSFER_PROFILES = {
  reliable: { name: "Reliable", frameBytes: 1465, fps: 20, ecc: "L" },
  fast: { name: "Fast", frameBytes: 2953, fps: 24, ecc: "L" },
  turbo: { name: "Turbo", frameBytes: 2953, fps: 30, ecc: "L" },
};

export function chooseTransferPlan(packageLength, profileName = "reliable") {
  const profile = TRANSFER_PROFILES[profileName] || TRANSFER_PROFILES.reliable;
  const maxBlockLength = profile.frameBytes - HEADER_LEN;
  const length = Math.max(1, Number(packageLength) || 1);

  if (length <= 700) {
    return {
      ...profile,
      blockLen: length,
      fps: 1,
      ecc: "M",
      staticQr: true,
      label: "Static one-QR mode",
    };
  }

  if (length <= 4096) {
    return {
      ...profile,
      blockLen: Math.min(maxBlockLength, 512),
      fps: Math.min(profile.fps, 6),
      ecc: "M",
      staticQr: false,
      label: "Small-file mode",
    };
  }

  if (length <= 16384) {
    return {
      ...profile,
      blockLen: Math.min(maxBlockLength, 896),
      fps: Math.min(profile.fps, 10),
      ecc: "L",
      staticQr: false,
      label: "Balanced mode",
    };
  }

  return {
    ...profile,
    blockLen: maxBlockLength,
    staticQr: false,
    label: profile.name,
  };
}
