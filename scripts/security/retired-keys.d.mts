export const retiredKeys: readonly { historicalPath: string; gitBlob: string; publicKey: string }[];
export function assertNotRetiredPublicKey<T extends string | { toBase58(): string }>(value: T, role?: string): T;
