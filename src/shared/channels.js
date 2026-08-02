export const CHANNEL_MODES = {
  standard: { name: "Standard", count: 1, multiplier: "1x" },
  double: { name: "Double", count: 2, multiplier: "2x" },
  quad: { name: "Quad", count: 4, multiplier: "4x" },
};

export function getChannelMode(name = "standard") {
  return CHANNEL_MODES[name] || CHANNEL_MODES.standard;
}

export function makeSequenceBatch(start, count) {
  return Array.from({ length: count }, (_, index) => start + index);
}

export function expectedDisplayFrames(sourceBlocks, overhead, channelCount) {
  const packets = Math.max(1, Math.ceil(sourceBlocks * overhead));
  return Math.max(1, Math.ceil(packets / Math.max(1, channelCount)));
}
