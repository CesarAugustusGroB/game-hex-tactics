import raw from './factions.json';

export type FactionId = string;
type CoreType = 'infantry' | 'cavalry' | 'skirmisher';

export interface Faction {
  label: string;
  /** Per-type texture stem under `assetDir` (no extension). */
  units: Record<CoreType, string>;
}

interface RawData {
  assetDir: string;
  teamDefault: { red: FactionId; blue: FactionId };
  factions: Record<string, Faction>;
}

const data = raw as RawData;

export const FACTIONS = data.factions;
export const FACTION_IDS = Object.keys(FACTIONS);
export const FACTION_TEAM_DEFAULT = data.teamDefault;
export const FACTION_ASSET_DIR = data.assetDir;

/** Distinct texture stems across every faction — the preload set. */
export const FACTION_TEXTURE_STEMS = [
  ...new Set(Object.values(FACTIONS).flatMap(f => Object.values(f.units))),
];

export const factionTexturePath = (stem: string): string => `${FACTION_ASSET_DIR}${stem}.png`;
