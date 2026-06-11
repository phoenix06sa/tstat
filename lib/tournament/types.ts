// Shared types for tournament data processing.
// AES API payloads are untyped (`any`) at the boundary; these types describe
// the structures we build from them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AesPlay = any;

export interface DayPlays {
  date: string;
  plays: AesPlay[];
}

export interface BracketEntry {
  date: string;
  play: AesPlay;
}

export interface FinishRange {
  best: number;
  worst: number;
}

export type FinishRangeMap = Record<string, FinishRange>;
