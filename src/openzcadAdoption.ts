import type { OpenZCADChannel } from "./contract";

const count = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export async function writeAdoptionSnapshot(
  db: D1Database,
  channel: OpenZCADChannel,
  value: unknown,
  now = new Date(),
): Promise<{ accepted: boolean }> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid adoption snapshot");
  const row = value as Record<string, unknown>;
  const { generation, accounts, signedInAccounts, signInSessions } = row;
  if (
    Object.keys(row).length !== 4 ||
    !count(generation) || generation === 0 ||
    !count(accounts) || !count(signedInAccounts) || !count(signInSessions) ||
    signedInAccounts > accounts || signInSessions < signedInAccounts ||
    (signedInAccounts === 0 && signInSessions !== 0)
  ) throw new Error("Invalid adoption snapshot");
  const result = await db
    .prepare(
      `INSERT INTO daily_openzcad_adoption(day,channel,generation,accounts,signedInAccounts,signInSessions)
       SELECT ?,?,?,?,?,? WHERE ? > COALESCE((SELECT MAX(generation) FROM daily_openzcad_adoption WHERE channel=?),0)
       ON CONFLICT(day,channel) DO UPDATE SET generation=excluded.generation,accounts=excluded.accounts,
         signedInAccounts=excluded.signedInAccounts,signInSessions=excluded.signInSessions`,
    )
    .bind(now.toISOString().slice(0, 10), channel, generation, accounts, signedInAccounts, signInSessions, generation, channel)
    .run();
  return { accepted: result.meta.changes > 0 };
}
