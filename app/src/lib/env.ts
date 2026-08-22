const WEAK_DEFAULTS = [
  "change-me",
  "paperless",
  "admin123",
  "admin",
  "change-me-in-production",
  "change-me-32-characters-min!!",
  "change-me-32-characters-minimum!!",
];

export function assertProductionSecrets(): string[] {
  const warnings: string[] = [];
  const checks: Array<[string, string | undefined]> = [
    ["NEXTAUTH_SECRET", process.env.NEXTAUTH_SECRET],
    ["ENCRYPTION_KEY", process.env.ENCRYPTION_KEY],
  ];

  for (const [name, value] of checks) {
    if (!value) {
      warnings.push(`${name} is missing`);
      continue;
    }
    if (WEAK_DEFAULTS.some((w) => value.includes(w) || value === w)) {
      warnings.push(`${name} still uses a weak/default value`);
    }
  }

  if ((process.env.ENCRYPTION_KEY?.length ?? 0) < 32) {
    warnings.push("ENCRYPTION_KEY should be at least 32 characters");
  }

  return warnings;
}
