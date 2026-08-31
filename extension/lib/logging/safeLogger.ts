type SafeMetadata = Record<string, boolean | number | string | null | undefined>;

const FORBIDDEN_KEY = /(password|secret|token|cookie|authorization|otp|raw|value)/i;

function sanitize(metadata: SafeMetadata): SafeMetadata {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      FORBIDDEN_KEY.test(key) ? '[REDACTED]' : value,
    ]),
  );
}

export const safeLogger = {
  info(scope: string, event: string, metadata: SafeMetadata = {}): void {
    console.info(`[${scope}] ${event}`, sanitize(metadata));
  },
  error(scope: string, event: string, metadata: SafeMetadata = {}): void {
    console.error(`[${scope}] ${event}`, sanitize(metadata));
  },
};

