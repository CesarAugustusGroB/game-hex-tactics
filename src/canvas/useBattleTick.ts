import { useEffect } from 'react';
import type { MutableRefObject, RefObject, Dispatch, SetStateAction } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { simulateTick } from '../battle/simulate';
import type { Team, GroupId } from '../battle/simulate';
import { getAiController } from '../battle/ai';
import type { OrderChange } from '../battle/ai';
import { getTerrainMods } from '../battle/terrain';
import {
  DAMAGE_PER_TICK, TICK_MS, CAPTURE_TICKS_TO_WIN, CAPTURE_ZONE_HEXES,
  captureZoneKeys, deployZoneFor,
  type Armies, type GroupOrders,
} from './constants';
import { TERRAINS } from './terrain-defs';

export interface BattleTickCtx {
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  armiesRef: MutableRefObject<Armies>;
  groupOrdersRef: MutableRefObject<GroupOrders>;
  gridDataRef: MutableRefObject<{ hex: Hex; type: string }[]>;
  captureProgressRef: MutableRefObject<{ red: number; blue: number }>;
  // MUST stay monotonic across battle pauses/restarts — units carry absolute
  // `nextMoveTick` values; resetting strands them on multi-hundred-tick cooldowns.
  tickCounterRef: MutableRefObject<number>;
  lastTickHadBothTeamsRef: MutableRefObject<boolean>;
  projectilesGfx: RefObject<PIXI.Container>;
  javelinTextureRef: RefObject<PIXI.Texture | null>;
  issueOrder: (team: Team, groupId: GroupId, change: OrderChange) => void;
  clearOrder: (team: Team, groupId: GroupId) => void;
  setArmies: Dispatch<SetStateAction<Armies>>;
  setGroupOrders: Dispatch<SetStateAction<GroupOrders>>;
  setCaptureProgress: Dispatch<SetStateAction<{ red: number; blue: number }>>;
  setWinBanner: Dispatch<SetStateAction<Team | null>>;
  setIsBattleRunning: Dispatch<SetStateAction<boolean>>;
}

export function useBattleTick(ctx: BattleTickCtx, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const strategic = ctx.currentStrategicHexRef.current;
      if (!strategic) return;
      const strategicKey = HexUtils.key(strategic);
      const units = ctx.armiesRef.current.get(strategicKey) ?? [];
      if (units.length === 0) return;
      // simulateTick BEFORE the setters — reading a closure variable written inside a
      // setX(prev => ...) on the next line is undefined (the updater hasn't run yet).
      const teamsBefore = new Set(units.map(u => u.team));
      if (teamsBefore.size >= 2) ctx.lastTickHadBothTeamsRef.current = true;
      const grid = ctx.gridDataRef.current;
      const gridSet = new Set(grid.map(d => HexUtils.key(d.hex)));
      const terrainAt = new Map(grid.map(d => [HexUtils.key(d.hex), d.type]));
      // Precompute deploy zone hex sets — the retreat-clear logic queries this per tick.
      const deployZones: Record<Team, Set<string>> = {
        red:  deployZoneFor('red',  grid),
        blue: deployZoneFor('blue', grid),
      };
      ctx.tickCounterRef.current += 1;
      // AI phase. Each registered controller writes its team's orders via `issueOrder`,
      // which mutates the orders ref synchronously — so the `simulateTick` call below
      // reads the post-AI order map, no one-tick lag.
      for (const team of (['red', 'blue'] as const)) {
        const fn = getAiController(team);
        if (!fn) continue;
        const myUnits = units.filter(u => u.team === team);
        const enemyUnits = units.filter(u => u.team !== team);
        const myOrders = Array.from(ctx.groupOrdersRef.current.values()).filter(o => o.team === team);
        try {
          fn({
            team,
            tick: ctx.tickCounterRef.current,
            myUnits,
            enemyUnits,
            myOrders,
            allOrders: ctx.groupOrdersRef.current,
            gridData: grid,
            issueOrder: (gid, change) => ctx.issueOrder(team, gid, change),
            clearOrder: (gid) => ctx.clearOrder(team, gid),
          });
        } catch (err) {
          console.error(`[ai] controller for team ${team} threw:`, err);
        }
      }
      const result = simulateTick(units, ctx.groupOrdersRef.current, {
        damagePerTick: DAMAGE_PER_TICK,
        currentTick: ctx.tickCounterRef.current,
        captureZone: CAPTURE_ZONE_HEXES,
        mapApi: {
          isInside: (h: Hex) => gridSet.has(HexUtils.key(h)),
          isWalkable: (h: Hex) => {
            const t = terrainAt.get(HexUtils.key(h));
            return t ? TERRAINS[t].walkable : false;
          },
          getTerrainType: (h: Hex) => terrainAt.get(HexUtils.key(h)),
          getTerrainMods: (h: Hex) => getTerrainMods(terrainAt.get(HexUtils.key(h))),
          getTerrainHeight: (h: Hex) => {
            const t = terrainAt.get(HexUtils.key(h));
            return t ? TERRAINS[t].height : 0;
          },
          isInDeployZone: (t: Team, h: Hex) => deployZones[t].has(HexUtils.key(h)),
        },
      });

      const javelinTex = ctx.javelinTextureRef.current;
      if (javelinTex && result.projectiles.length > 0) {
        // Asset's natural tip points up-left (1813×822 diagonal). atan2(-670, -1610) is
        // the from-butt-to-tip angle; subtract to rotate the throw to face the target.
        const assetTipAngle = Math.atan2(-670, -1610);
        const container = ctx.projectilesGfx.current!;
        for (const p of result.projectiles) {
          const fromPx = HexUtils.hexToPixel(p.fromHex);
          const toPx = HexUtils.hexToPixel(p.toHex);
          const dxp = toPx.x - fromPx.x;
          const dyp = toPx.y - fromPx.y;
          const sprite = new PIXI.Sprite(javelinTex);
          sprite.anchor.set(0.5, 0.5);
          const targetLengthPx = 50;
          const intrinsicLen = Math.max(javelinTex.width, 1);
          const s = targetLengthPx / intrinsicLen;
          sprite.scale.set(s, s);
          sprite.rotation = Math.atan2(dyp, dxp) - assetTipAngle;
          sprite.x = fromPx.x;
          sprite.y = fromPx.y;
          container.addChild(sprite);
          gsap.to(sprite, {
            x: toPx.x,
            y: toPx.y,
            duration: 0.25,
            ease: 'none',
            onComplete: () => {
              gsap.killTweensOf(sprite);
              if (sprite.parent) sprite.parent.removeChild(sprite);
              sprite.destroy();
            },
          });
        }
      }

      const next = result.units;

      // Capture-the-flag tick. Count living units per team in the central 7-hex flower;
      // apply uncontested-progress / contested-decay; trigger win at threshold. Annihilation
      // check below still applies as a fallback.
      {
        const zone = captureZoneKeys();
        let redInZone = 0, blueInZone = 0;
        for (const u of next) {
          if (u.hp <= 0) continue;
          if (!zone.has(HexUtils.key(u.tacticalHex))) continue;
          if (u.team === 'red') redInZone++;
          else blueInZone++;
        }
        const cur = ctx.captureProgressRef.current;
        const redUncontested  = redInZone  > 0 && blueInZone === 0;
        const blueUncontested = blueInZone > 0 && redInZone  === 0;
        const contested = redInZone > 0 && blueInZone > 0;
        let nextRed = cur.red, nextBlue = cur.blue;
        if (redUncontested) {
          nextRed  = Math.min(CAPTURE_TICKS_TO_WIN, cur.red + 1);
          nextBlue = Math.max(0, cur.blue - 1);
        } else if (blueUncontested) {
          nextBlue = Math.min(CAPTURE_TICKS_TO_WIN, cur.blue + 1);
          nextRed  = Math.max(0, cur.red - 1);
        } else if (contested) {
          nextRed  = Math.max(0, cur.red - 1);
          nextBlue = Math.max(0, cur.blue - 1);
        }
        if (nextRed !== cur.red || nextBlue !== cur.blue) {
          ctx.captureProgressRef.current = { red: nextRed, blue: nextBlue };
          ctx.setCaptureProgress({ red: nextRed, blue: nextBlue });
        }
        if (nextRed >= CAPTURE_TICKS_TO_WIN) {
          ctx.setWinBanner('red');
          ctx.setIsBattleRunning(false);
          window.setTimeout(() => ctx.setWinBanner(null), 3000);
        } else if (nextBlue >= CAPTURE_TICKS_TO_WIN) {
          ctx.setWinBanner('blue');
          ctx.setIsBattleRunning(false);
          window.setTimeout(() => ctx.setWinBanner(null), 3000);
        }
      }

      const teamsAfter = new Set(next.map(u => u.team));
      if (teamsAfter.size === 1 && ctx.lastTickHadBothTeamsRef.current) {
        const winner = next[0]?.team ?? null;
        if (winner) {
          ctx.setWinBanner(winner);
          ctx.setIsBattleRunning(false);
          ctx.lastTickHadBothTeamsRef.current = false;
          window.setTimeout(() => ctx.setWinBanner(null), 3000);
        }
      }
      ctx.setArmies(prev => {
        const updated = new Map(prev);
        updated.set(strategicKey, next);
        return updated;
      });
      if (result.orders !== ctx.groupOrdersRef.current) ctx.setGroupOrders(result.orders);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, ctx.issueOrder, ctx.clearOrder]); // eslint-disable-line react-hooks/exhaustive-deps
}
