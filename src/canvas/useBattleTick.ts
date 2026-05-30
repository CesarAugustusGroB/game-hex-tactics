import { useEffect } from 'react';
import type { MutableRefObject, RefObject, Dispatch, SetStateAction } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { HexUtils, type Hex } from '../hex-engine/HexUtils';
import { simulateTick, MAX_HP_BY_TYPE } from '../battle/simulate';
import type { Team, GroupId, UnitType, Unit } from '../battle/simulate';
import { getAiController } from '../battle/ai';
import type { OrderChange } from '../battle/ai';
import { getTerrainMods } from '../battle/terrain';
import { applyRegen, debit, CP_REGEN_PER_TICK_STEP, type CommandPoints } from '../battle/command-points';
import { spawnMeleeEffects } from './render/meleeFx';
import {
  DAMAGE_PER_TICK, TICK_MS, CAPTURE_ZONE_HEXES,
  POINTS_TO_WIN, POINTS_PER_UNIT_REACHED, CENTER_HOLD_POINTS_PER_TICK,
  COHORT_SIZE, INITIAL_ROSTER,
  captureZoneKeys, deployZoneFor,
  type Armies, type GroupOrders, type Rosters,
} from './constants';
import { scoreTick } from '../battle/scoring';
import { TERRAINS } from './terrain-defs';

const CENTER_ZONE_KEYS = captureZoneKeys();

export interface BattleTickCtx {
  currentStrategicHexRef: MutableRefObject<Hex | null>;
  armiesRef: MutableRefObject<Armies>;
  rostersRef: MutableRefObject<Rosters>;
  groupOrdersRef: MutableRefObject<GroupOrders>;
  gridDataRef: MutableRefObject<{ hex: Hex; type: string }[]>;
  scoreRef: MutableRefObject<{ red: number; blue: number }>;
  // MUST stay monotonic across battle pauses/restarts — units carry absolute
  // `nextMoveTick` values; resetting strands them on multi-hundred-tick cooldowns.
  tickCounterRef: MutableRefObject<number>;
  worldRef: MutableRefObject<PIXI.Container>;
  unitContainersRef: MutableRefObject<Map<string, PIXI.Container>>;
  combatFxGfx: RefObject<PIXI.Container>;
  projectilesGfx: RefObject<PIXI.Container>;
  javelinTextureRef: RefObject<PIXI.Texture | null>;
  dustTextureRef: RefObject<PIXI.Texture | null>;
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
  cpRegenRef: MutableRefObject<number>;
  cpMaxRef: MutableRefObject<number>;
  // Group-order keys whose firstMarch surcharge is already paid this battle. Pruned here
  // when a group empties so a recycled slot re-pays firstMarch.
  marchedGroupsRef: MutableRefObject<Set<string>>;
  setMarchedGroups: Dispatch<SetStateAction<Set<string>>>;
}

export function useBattleTick(ctx: BattleTickCtx, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const strategic = ctx.currentStrategicHexRef.current;
      if (!strategic) return;
      const strategicKey = HexUtils.key(strategic);
      const units = ctx.armiesRef.current.get(strategicKey) ?? [];
      // Don't bail on an empty field while an AI is registered — it must be allowed to deploy
      // its own army from an empty start. Otherwise the AI can't act until the player puts a
      // unit down (the controller's placeCohort runs inside the AI phase below).
      const hasAi = !!(getAiController('red') || getAiController('blue'));
      if (units.length === 0 && !hasAi) return;
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
      const cpAfter = applyRegen(cpBefore, CP_REGEN_PER_TICK_STEP * ctx.cpRegenRef.current, ctx.cpMaxRef.current);
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
            roster: ctx.rostersRef.current.get(team) ?? { ...INITIAL_ROSTER },
            deployZone: deployZones[team],
            placeCohort: (gid, anchor, unitType: UnitType) => {
              const roster = ctx.rostersRef.current.get(team) ?? { ...INITIAL_ROSTER };
              const remaining = roster[unitType] ?? 0;
              if (remaining <= 0) return false;
              const zone = deployZones[team];
              const existing = ctx.armiesRef.current.get(strategicKey) ?? [];
              const occupied = new Set(existing.map(u => HexUtils.key(u.tacticalHex)));
              const target: Hex[] = [];
              const candidates: Hex[] = [anchor, ...HexUtils.getNeighbors(anchor)];
              const cap = Math.min(COHORT_SIZE, remaining);
              for (const c of candidates) {
                if (target.length >= cap) break;
                const k = HexUtils.key(c);
                if (!zone.has(k) || occupied.has(k)) continue;
                target.push(c);
                occupied.add(k);
              }
              if (target.length === 0) return false;
              const debited = debit(ctx.commandPointsRef.current, team, 'placeCohort');
              if (!debited) return false;
              ctx.commandPointsRef.current = debited;
              ctx.setCommandPoints(debited);
              const newUnits: Unit[] = target.map(h => ({
                id: crypto.randomUUID(),
                team,
                unitType,
                tacticalHex: h,
                homeHex: h,
                groupId: gid,
                hp: MAX_HP_BY_TYPE[unitType],
                state: 'idle' as const,
                nextMoveTick: 0,
                visionRadius: getTerrainMods(terrainAt.get(HexUtils.key(h))).visionRadius,
              }));
              const nextArmies = new Map(ctx.armiesRef.current);
              nextArmies.set(strategicKey, [...existing, ...newUnits]);
              ctx.armiesRef.current = nextArmies;
              ctx.setArmies(nextArmies);
              const nextRosters = new Map(ctx.rostersRef.current);
              nextRosters.set(team, { ...roster, [unitType]: roster[unitType] - newUnits.length });
              ctx.rostersRef.current = nextRosters;
              ctx.setRosters(nextRosters);
              return true;
            },
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
      // The AI phase may have appended freshly-deployed units via placeCohort (which mutates
      // armiesRef synchronously). Re-read so the sim — and the end-of-tick setArmies that
      // derives `survivors` — include them; otherwise newly-placed units are dropped this tick.
      const liveUnits = ctx.armiesRef.current.get(strategicKey) ?? units;
      // Field still empty after the AI phase (no AI deployed yet) — nothing to simulate.
      if (liveUnits.length === 0) return;
      const result = simulateTick(liveUnits, ctx.groupOrdersRef.current, {
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
      if (result.meleeEvents.length > 0) {
        spawnMeleeEffects({
          combatFxGfx: ctx.combatFxGfx.current!,
          unitContainers: ctx.unitContainersRef.current,
          dustTexture: ctx.dustTextureRef.current,
          events: result.meleeEvents,
          worldScale: ctx.worldRef.current.scale.x,
        });
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
        centerKeys: CENTER_ZONE_KEYS,
        scoringZone: { red: deployZones.blue, blue: deployZones.red },
        config: {
          pointsToWin: POINTS_TO_WIN,
          pointsPerUnitReached: POINTS_PER_UNIT_REACHED,
          centerHoldPointsPerTick: CENTER_HOLD_POINTS_PER_TICK,
        },
      });
      // Units that reached the enemy line leave the field. Removal is async (via setArmies
      // below → armiesRef mirror), but scoreRef updates synchronously, so single-scoring
      // relies on React flushing setArmies within one TICK_MS window — otherwise a reached
      // unit would still be in armiesRef next tick and score again. Safe at 500ms ticks.
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
      // Victory is only by reaching POINTS_TO_WIN. A team having no units left on the field
      // is normal (units raid the enemy line and return to roster), so it is not a loss.
      if (sc.winner) {
        ctx.setWinBanner(sc.winner);
        ctx.setIsBattleRunning(false);
        window.setTimeout(() => ctx.setWinBanner(null), 3000);
      }
      ctx.setArmies(prev => {
        const updated = new Map(prev);
        updated.set(strategicKey, survivors);
        return updated;
      });
      // A group that just emptied (all units died, or raided the line & returned to roster)
      // keeps its stale march/charge/committed order. Reset it to idle so when the freed
      // slot is recycled, the freshly-placed units start idle instead of inheriting the old
      // advance and immediately running off the deploy zone.
      const liveGroups = new Set(survivors.map(u => `${u.team}:${u.groupId}`));
      let orders = result.orders;
      for (const [key, o] of orders) {
        if (liveGroups.has(key)) continue;
        const stale = o.attackTarget != null || (o.mode != null && o.mode !== 'idle') || o.committed;
        if (!stale) continue;
        if (orders === result.orders) orders = new Map(orders);
        orders.set(key, { team: o.team, groupId: o.groupId, heading: o.heading, attackTarget: null, mode: 'idle' });
      }
      // Drop dead groups' keys from marchedGroups so a recycled slot re-pays firstMarch
      // (keeps the anti-drip-feed surcharge from leaking on recycle).
      const marched = ctx.marchedGroupsRef.current;
      let prunedMarched: Set<string> | null = null;
      for (const key of marched) {
        if (liveGroups.has(key)) continue;
        if (!prunedMarched) prunedMarched = new Set(marched);
        prunedMarched.delete(key);
      }
      if (prunedMarched) {
        ctx.marchedGroupsRef.current = prunedMarched;
        ctx.setMarchedGroups(prunedMarched);
      }
      if (orders !== ctx.groupOrdersRef.current) ctx.setGroupOrders(orders);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, ctx.issueOrder, ctx.clearOrder]); // eslint-disable-line react-hooks/exhaustive-deps
}
