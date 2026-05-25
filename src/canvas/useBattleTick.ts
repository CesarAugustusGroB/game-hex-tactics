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
import { applyRegen, debit, type CommandPoints } from '../battle/command-points';
import {
  DAMAGE_PER_TICK, TICK_MS, CAPTURE_ZONE_HEXES,
  POINTS_TO_WIN, POINTS_PER_UNIT_REACHED, CENTER_HOLD_POINTS_PER_TICK,
  captureZoneKeys, deployZoneFor,
  type Armies, type GroupOrders, type Rosters,
} from './constants';
import { scoreTick } from '../battle/scoring';
import { TERRAINS } from './terrain-defs';

export interface BattleTickCtx {
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  armiesRef: MutableRefObject<Armies>;
  groupOrdersRef: MutableRefObject<GroupOrders>;
  gridDataRef: MutableRefObject<{ hex: Hex; type: string }[]>;
  scoreRef: MutableRefObject<{ red: number; blue: number }>;
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
  setScore: Dispatch<SetStateAction<{ red: number; blue: number }>>;
  setWinBanner: Dispatch<SetStateAction<Team | null>>;
  setRosters: Dispatch<SetStateAction<Rosters>>;
  setIsBattleRunning: Dispatch<SetStateAction<boolean>>;
  commandPointsRef: MutableRefObject<CommandPoints>;
  setCommandPoints: Dispatch<SetStateAction<CommandPoints>>;
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
      const cpBefore = ctx.commandPointsRef.current;
      const cpAfter = applyRegen(cpBefore, ctx.tickCounterRef.current);
      if (cpAfter !== cpBefore) {
        ctx.commandPointsRef.current = cpAfter;
        ctx.setCommandPoints(cpAfter);
      }
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
            cp: ctx.commandPointsRef.current[team],
            issueOrder: (gid, change, intent) => {
              const next = debit(ctx.commandPointsRef.current, team, intent);
              if (next === null) return false;
              ctx.commandPointsRef.current = next;
              ctx.setCommandPoints(next);
              ctx.issueOrder(team, gid, change);
              return true;
            },
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

      // Scoring tick (race to POINTS_TO_WIN). Two point sources:
      //  - a living unit standing in the ENEMY deploy zone scores POINTS_PER_UNIT_REACHED,
      //    refunds 1 of its type to its roster, and leaves the field (raid & return);
      //  - uncontested presence in the central flower accrues CENTER_HOLD_POINTS_PER_TICK.
      // Points only accumulate — they never decay. Annihilation below is still a fallback.
      const sc = scoreTick({
        units: next,
        score: ctx.scoreRef.current,
        centerKeys: captureZoneKeys(),
        scoringZone: { red: deployZones.blue, blue: deployZones.red },
        config: {
          pointsToWin: POINTS_TO_WIN,
          pointsPerUnitReached: POINTS_PER_UNIT_REACHED,
          centerHoldPointsPerTick: CENTER_HOLD_POINTS_PER_TICK,
        },
      });
      const survivors = sc.reachedUnitIds.size > 0
        ? next.filter(u => !sc.reachedUnitIds.has(u.id))
        : next;
      if (sc.changed) {
        ctx.scoreRef.current = sc.score;
        ctx.setScore(sc.score);
      }
      if (sc.reachedUnitIds.size > 0) {
        ctx.setRosters(prev => {
          const m = new Map(prev);
          for (const team of (['red', 'blue'] as const)) {
            const d = sc.rosterDelta[team];
            if (d.infantry === 0 && d.cavalry === 0 && d.skirmisher === 0) continue;
            const r = m.get(team)!;
            m.set(team, {
              infantry: r.infantry + d.infantry,
              cavalry: r.cavalry + d.cavalry,
              skirmisher: r.skirmisher + d.skirmisher,
            });
          }
          return m;
        });
      }
      if (sc.winner) {
        ctx.setWinBanner(sc.winner);
        ctx.setIsBattleRunning(false);
        window.setTimeout(() => ctx.setWinBanner(null), 3000);
      }

      const teamsAfter = new Set(survivors.map(u => u.team));
      if (teamsAfter.size === 1 && ctx.lastTickHadBothTeamsRef.current) {
        const winner = survivors[0]?.team ?? null;
        if (winner) {
          ctx.setWinBanner(winner);
          ctx.setIsBattleRunning(false);
          ctx.lastTickHadBothTeamsRef.current = false;
          window.setTimeout(() => ctx.setWinBanner(null), 3000);
        }
      }
      ctx.setArmies(prev => {
        const updated = new Map(prev);
        updated.set(strategicKey, survivors);
        return updated;
      });
      if (result.orders !== ctx.groupOrdersRef.current) ctx.setGroupOrders(result.orders);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, ctx.issueOrder, ctx.clearOrder]); // eslint-disable-line react-hooks/exhaustive-deps
}
