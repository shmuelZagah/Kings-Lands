import { FX_ONE, fxClamp, fxHypot } from '../core/fx.js';
import { CommandTypes } from '../core/commandBus.js';
import { FormationTypes } from './formations/formations.js';
import { CompanyOrderType } from './formations/company.js';

export function resolveTargetCompanies(gameState, team, companyIds) {
  const selected = [];
  if (Array.isArray(companyIds) && companyIds.length > 0) {
    for (let i = 0; i < companyIds.length; i++) {
      const comp = gameState.companies.get(companyIds[i] | 0);
      if (comp && comp.team === (team | 0) && comp.memberIds.length > 0) {
        selected.push(comp);
      }
    }
  }
  selected.sort((a, b) => a.id - b.id);
  return selected;
}

export function applyHalfDamageCheat(gameState, team = 1, buildingId = null) {
  if (buildingId) {
    const b = gameState.constructionSystem.buildings.get(buildingId | 0);
    if (b && b.hp > 0 && b.type !== 'citadel_slot') {
      b.hp = Math.max(25, (b.hp >> 1) | 0);
    }
    return;
  }
  const bIds = gameState.constructionSystem.sortedBuildingIds;
  for (let i = 0; i < bIds.length; i++) {
    const b = gameState.constructionSystem.buildings.get(bIds[i]);
    if (b && b.team === (team | 0) && b.isCompleted && b.hp > 0 && b.type !== 'citadel_slot') {
      b.hp = Math.max(25, (b.hp >> 1) | 0);
    }
  }
}

export function processSimCommands(gameState, commands) {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;
    const { type, payload } = cmd;

    if (type === CommandTypes.DEV_CHEAT) {
      const code = String(payload?.code || '').trim().replace(/^\/+/, '').trim().toLowerCase();
      if (code === 'q' || code === 'add' || code === 'resources') {
        gameState.economySystem.grantCheatResources((payload?.team | 0) || 1, 1000);
      } else if (code === 'ballista' || code === 'siege') {
        const teamId = (payload?.team | 0) || 1;
        const spawnZ = teamId === 1 ? 1745 : 2350;
        gameState.spawnCompany({
          name: 'Royal Siege Ballista Battery',
          team: teamId,
          unitType: 'ballista',
          count: 3,
          spawnMetersX: 2048,
          spawnMetersZ: spawnZ,
          facingDir: teamId === 1 ? 256 : 768,
          speedFx: 178,
          hp: 260
        });
      } else if (code === 'lv' || code === 'levelup' || code === 'xp') {
        for (const comp of gameState.companies.values()) {
          if (comp && comp.team === ((payload?.team | 0) || 1) && comp.isHero && comp.heroLevel < 10) {
            const ent = gameState.entities.get(comp.memberIds[0]);
            if (ent && ent.hp > 0) {
              gameState.heroSystem?.advanceHeroToLevel?.(gameState, comp, ent, comp.heroLevel + 1, true);
            }
          }
        }
      } else if (code === 'damage' || code === 'd') {
        applyHalfDamageCheat(gameState, (payload?.team | 0) || 1, payload?.buildingId || null);
      } else if (code.startsWith('ai')) {
        const arg = code.replace(/^ai\s*/, '').trim() || 'adaptive';
        gameState.enemyAi?.setMode?.(arg);
      } else if (code === 'c' || code === 'fow' || code === 'fog' || code === 'nofog') {
        if (gameState.visionSystem) {
          gameState.visionSystem.revealAllCheat = !gameState.visionSystem.revealAllCheat;
          gameState.visionSystem.update(gameState, true);
        }
      } else if (code === 'laststand') {
        // Destroy all Enemy (Team 2) production buildings so Team 2 enters LAST STAND
        for (const b of gameState.constructionSystem.buildings.values()) {
          if (b && b.team === 2 && gameState.victorySystem?.isProductionBuilding(b)) {
            b.hp = 0;
            b.isDestroyed = true;
          }
        }
      } else if (code === 'win' || code === 'victory') {
        if (gameState.victorySystem) {
          gameState.victorySystem.startCollapseForTeam(gameState, 2);
        }
      } else if (code === 'lose' || code === 'defeat') {
        if (gameState.victorySystem) {
          gameState.victorySystem.startCollapseForTeam(gameState, 1);
        }
      } else if (code === 'panic' || code === 'rout') {
        // Rout 2 nearby combat companies of Team 1 to demonstrate the Regional Retreat Cascade
        let routed = 0;
        for (const comp of gameState.companies.values()) {
          if (comp && comp.team === 1 && comp.unitType !== 'worker' && !comp.isBroken) {
            comp.moralePermille = 150;
            gameState.moraleStaminaSystem.triggerCompanyBreak(gameState, comp, false);
            routed++;
            if (routed >= 2) break;
          }
        }
      }
      continue;
    }

    if (type === CommandTypes.SWITCH_COMPANY_WEAPON) {
      const targetTeam = (payload?.team | 0) || 1;
      const cids = Array.isArray(payload?.companyIds)
        ? payload.companyIds
        : payload?.companyId !== undefined
          ? [payload.companyId]
          : [];
      for (let c = 0; c < cids.length; c++) {
        const comp = gameState.companies.get(cids[c] | 0);
        if (!comp || comp.team !== targetTeam) continue;
        if (comp.isHero) {
          gameState.heroSystem?.switchHeroWeapon?.(gameState, comp.id, targetTeam);
        } else {
          comp.switchWeaponSet?.(gameState.navGrid, gameState.entities, gameState.movementSystem);
        }
      }
      continue;
    }

    if (type === CommandTypes.SET_COMPANY_COMBAT_MODE) {
      const targetTeam = (payload?.team | 0) || 1;
      const selectedCompanies = resolveTargetCompanies(gameState, targetTeam, payload?.companyIds);
      for (let c = 0; c < selectedCompanies.length; c++) {
        const comp = selectedCompanies[c];
        if (payload.holdGround !== undefined) comp.holdGround = Boolean(payload.holdGround);
        if (payload.skirmishKite !== undefined) comp.skirmishKite = Boolean(payload.skirmishKite);
        if (payload.fireAtWill !== undefined) comp.fireAtWill = Boolean(payload.fireAtWill);
      }
      continue;
    }

    if (type === CommandTypes.CAST_HERO_SPELL) {
      gameState.heroSystem?.castHeroSpell?.(
        gameState,
        payload.companyId | 0,
        payload.spellId ?? payload.slotIndex,
        (payload.team | 0) || 1,
        {
          targetXFx: typeof payload.targetXFx === 'number' ? payload.targetXFx | 0 : null,
          targetZFx: typeof payload.targetZFx === 'number' ? payload.targetZFx | 0 : null,
          targetEntityId: typeof payload.targetEntityId === 'number' ? payload.targetEntityId | 0 : -1,
          targetBuildingId: typeof payload.targetBuildingId === 'number' ? payload.targetBuildingId | 0 : -1
        }
      );
      continue;
    }

    if (type === CommandTypes.SWITCH_HERO_WEAPON) {
      const cid = payload.companyId | 0;
      const comp = gameState.companies.get(cid);
      if (comp && !comp.isHero) {
        comp.switchWeaponSet?.(gameState.navGrid, gameState.entities, gameState.movementSystem);
      } else {
        gameState.heroSystem?.switchHeroWeapon?.(
          gameState,
          cid,
          (payload.team | 0) || 1
        );
      }
      continue;
    }

    if (type === CommandTypes.LEVEL_UP_HERO_CHEAT) {
      const cid = payload?.companyId;
      for (const comp of gameState.companies.values()) {
        if (
          comp &&
          comp.team === ((payload?.team | 0) || 1) &&
          comp.isHero &&
          (cid === undefined || cid === null || comp.id === (cid | 0)) &&
          comp.heroLevel < 10
        ) {
          const ent = gameState.entities.get(comp.memberIds[0]);
          if (ent && ent.hp > 0) {
            gameState.heroSystem?.advanceHeroToLevel?.(gameState, comp, ent, comp.heroLevel + 1, true);
          }
        }
      }
      continue;
    }

    if (type === CommandTypes.DAMAGE_BUILDING_CHEAT) {
      applyHalfDamageCheat(gameState, (payload?.team | 0) || 1, payload?.buildingId || null);
      continue;
    }

    if (type === CommandTypes.GARRISON_BUILDING) {
      gameState.constructionSystem.orderCompaniesToGarrison(
        payload.companyIds || [],
        payload.buildingId | 0,
        (payload.team | 0) || 1,
        gameState,
        Boolean(payload.queue),
        Boolean(payload.isRunning)
      );
      continue;
    }

    if (type === CommandTypes.UNGARRISON_BUILDING) {
      gameState.constructionSystem.ungarrisonBuilding(
        payload.buildingId | 0,
        (payload.team | 0) || 1,
        gameState,
        payload.companyId !== undefined && payload.companyId !== null
          ? payload.companyId | 0
          : null
      );
      continue;
    }

    if (type === CommandTypes.SET_TOWER_TARGET) {
      const bIds = Array.isArray(payload.buildingIds)
        ? payload.buildingIds
        : [payload.buildingId | 0];
      for (let b = 0; b < bIds.length; b++) {
        gameState.constructionSystem.setTowerManualTarget(
          bIds[b] | 0,
          payload.targetEntityId | 0,
          (payload.team | 0) || 1
        );
      }
      continue;
    }

    if (
      type === CommandTypes.MOVE_COMPANIES ||
      type === CommandTypes.PATROL_COMPANIES ||
      type === CommandTypes.ATTACK_MOVE_COMPANIES
    ) {
      const targetTeam = (payload.team | 0) || 1;
      let selectedCompanies = resolveTargetCompanies(
        gameState,
        targetTeam,
        payload.companyIds
      );
      if (selectedCompanies.length === 0) {
        continue;
      }

      for (let sc = 0; sc < selectedCompanies.length; sc++) {
        if (selectedCompanies[sc]) selectedCompanies[sc].pendingSpellCast = null;
      }

      const startX = fxClamp(
        payload.dragStartXFx | 0,
        16 * FX_ONE,
        gameState.worldSizeFx - 16 * FX_ONE
      );
      const startZ = fxClamp(
        payload.dragStartZFx | 0,
        16 * FX_ONE,
        gameState.worldSizeFx - 16 * FX_ONE
      );
      const endX = fxClamp(
        (payload.dragEndXFx ?? startX) | 0,
        16 * FX_ONE,
        gameState.worldSizeFx - 16 * FX_ONE
      );
      const endZ = fxClamp(
        (payload.dragEndZFx ?? startZ) | 0,
        16 * FX_ONE,
        gameState.worldSizeFx - 16 * FX_ONE
      );

      const orderType =
        type === CommandTypes.PATROL_COMPANIES
          ? CompanyOrderType.PATROL
          : type === CommandTypes.ATTACK_MOVE_COMPANIES
            ? CompanyOrderType.ATTACK_MOVE
            : CompanyOrderType.MOVE;

      const isSinglePointMove =
        orderType === CompanyOrderType.MOVE &&
        fxHypot((endX - startX) | 0, (endZ - startZ) | 0) < 5 * FX_ONE &&
        (payload.targetEnemyCompanyId === undefined || payload.targetEnemyCompanyId === null || (payload.targetEnemyCompanyId | 0) < 0) &&
        (payload.targetEnemyBuildingId === undefined || payload.targetEnemyBuildingId === null || (payload.targetEnemyBuildingId | 0) <= 0);

      // Contextual Worker Safeguard: if a right-click point move includes worker companies and lands on an
      // unfinished/damaged friendly building or a resource node (mine/tree), assign the workers to build/gather
      // instead of cancelling their work and leaving them idle!
      if (isSinglePointMove) {
        const workerComps = selectedCompanies.filter((c) => c.unitType === 'worker');
        if (workerComps.length > 0) {
          const workerIds = workerComps.map((c) => c.id);
          let contextualHandledForWorkers = false;
          const blds = gameState.constructionSystem?.buildings;
          if (blds) {
            for (const b of blds.values()) {
              if (!b || b.isDestroyed || b.team !== targetTeam || b.type === 'citadel_slot' || b.hp <= 0) continue;
              const hitRadFx = Math.round(((b.footprintRadiusMeters || 4) + 3.2) * FX_ONE);
              if (fxHypot((b.xFx - startX) | 0, (b.zFx - startZ) | 0) <= hitRadFx) {
                if (!b.isCompleted || b.hp < b.maxHp) {
                  gameState.constructionSystem.assignWorkerCompaniesToBuilding(
                    workerIds,
                    b.id,
                    Boolean(payload.queue),
                    gameState,
                    Boolean(payload.isRunning)
                  );
                  contextualHandledForWorkers = true;
                  break;
                }
              }
            }
          }
          if (!contextualHandledForWorkers && gameState.economySystem) {
            const mine = gameState.economySystem.findNearestMine(startX, startZ, Math.round(4.5 * FX_ONE));
            const tree = !mine ? gameState.economySystem.findNearestGrownTree(startX, startZ, Math.round(3.6 * FX_ONE)) : null;
            if (mine || tree) {
              contextualHandledForWorkers = gameState.economySystem.assignWorkerGatheringOrder(
                workerIds,
                startX,
                startZ,
                targetTeam,
                gameState,
                Boolean(payload.queue),
                Boolean(payload.isRunning)
              );
            }
          }
          if (contextualHandledForWorkers) {
            selectedCompanies = selectedCompanies.filter((c) => c.unitType !== 'worker');
            if (selectedCompanies.length === 0) {
              continue;
            }
          }
        }
      }

      const isInterruptingPatrol =
        orderType !== CompanyOrderType.PATROL &&
        selectedCompanies.some(
          (c) =>
            c.orderType === CompanyOrderType.PATROL ||
            c.commandQueue.some((q) => q.orderType === CompanyOrderType.PATROL)
        );

      const effectiveQueue = Boolean(payload.queue) && !isInterruptingPatrol;

      for (let c = 0; c < selectedCompanies.length; c++) {
        selectedCompanies[c].hasPlayerOrder = true;
      }

      if (!effectiveQueue) {
        const cids = selectedCompanies.map((c) => c.id);
        gameState.economySystem.cancelGatheringForCompanies(
          cids,
          gameState.entities,
          gameState.companies
        );
        for (let c = 0; c < cids.length; c++) {
          gameState.constructionSystem.workerBuildQueues.delete(cids[c]);
          gameState.constructionSystem.pendingGarrisonOrders.delete(cids[c]);
          const comp = gameState.companies.get(cids[c]);
          if (comp) {
            comp.activeBuildTargetId = 0;
            comp.activeDropoffBuildingId = 0;
            comp.pendingGatherOrder = null;
          }
        }
      }

      gameState.movementSystem.issueArmyDragOrder(
        selectedCompanies,
        gameState.entities,
        { xFx: startX, zFx: startZ },
        { xFx: endX, zFx: endZ },
        orderType,
        gameState.tick,
        {
          queue: effectiveQueue,
          isRunning: Boolean(payload.isRunning),
          preserveRelative: Boolean(payload.preserveRelative),
          patrolWaypoints: payload.patrolWaypoints || null,
          targetEnemyCompanyId:
            payload.targetEnemyCompanyId !== undefined && payload.targetEnemyCompanyId !== null
              ? payload.targetEnemyCompanyId | 0
              : -1,
          targetEnemyBuildingId:
            payload.targetEnemyBuildingId !== undefined && payload.targetEnemyBuildingId !== null
              ? payload.targetEnemyBuildingId | 0
              : -1,
          gameState
        }
      );
    } else if (type === CommandTypes.STOP_COMPANIES) {
      const targetTeam = (payload.team | 0) || 1;
      const selectedCompanies = resolveTargetCompanies(
        gameState,
        targetTeam,
        payload.companyIds
      );
      if (selectedCompanies.length === 0) continue;
      const cids = selectedCompanies.map((c) => c.id);
      gameState.economySystem.cancelGatheringForCompanies(
        cids,
        gameState.entities,
        gameState.companies
      );
      for (let c = 0; c < selectedCompanies.length; c++) {
        gameState.constructionSystem.workerBuildQueues.delete(selectedCompanies[c].id);
        gameState.constructionSystem.pendingGarrisonOrders.delete(selectedCompanies[c].id);
        selectedCompanies[c].hasPlayerOrder = true;
        selectedCompanies[c].activeBuildTargetId = 0;
        selectedCompanies[c].activeDropoffBuildingId = 0;
        selectedCompanies[c].pendingGatherOrder = null;
        selectedCompanies[c].stopInPlace(gameState.navGrid, gameState.entities);
      }
    } else if (type === CommandTypes.SET_FORMATION) {
      const targetTeam = (payload.team | 0) || 1;
      const selectedCompanies = resolveTargetCompanies(
        gameState,
        targetTeam,
        payload.companyIds
      );
      for (let c = 0; c < selectedCompanies.length; c++) {
        selectedCompanies[c].setFormation(
          payload.formation,
          gameState.navGrid,
          gameState.entities
        );
      }
    } else if (type === CommandTypes.SET_COMPANY_GAIT) {
      const targetTeam = (payload.team | 0) || 1;
      const selectedCompanies = resolveTargetCompanies(
        gameState,
        targetTeam,
        payload.companyIds
      );

      if (payload.fireAtWill !== undefined && payload.fireAtWill !== null) {
        const nextFireAtWill = Boolean(payload.fireAtWill);
        for (let c = 0; c < selectedCompanies.length; c++) {
          const comp = selectedCompanies[c];
          comp.fireAtWill = nextFireAtWill;
          if (
            !nextFireAtWill &&
            (comp.targetEnemyCompanyId | 0) < 0 &&
            (comp.targetEnemyBuildingId | 0) <= 0
          ) {
            comp.engagedTargetEntityId = -1;
            comp.engagedTargetBuildingId = -1;
          }
        }
        continue;
      }

      const wantRunning = Boolean(payload.isRunning);
      const anyRunLockedInSelection = selectedCompanies.some(
        (comp) =>
          !comp ||
          comp.formation === FormationTypes.SPEAR_WALL ||
          comp.formation === FormationTypes.SHIELD_WALL ||
          comp.formation === FormationTypes.PIKE_PHALANX ||
          Boolean(comp.isSpearWallLocked) ||
          Boolean(comp.isBroken) ||
          (comp.staminaPermille | 0) <= 0
      );
      if (wantRunning && anyRunLockedInSelection) {
        continue;
      }
      for (let c = 0; c < selectedCompanies.length; c++) {
        const comp = selectedCompanies[c];
        if (!wantRunning) {
          comp.wantsToRun = false;
          comp.isRunning = false;
          if ((comp.altGroupId | 0) > 0 && Array.isArray(comp.altGroupCompanyIds)) {
            for (let g = 0; g < comp.altGroupCompanyIds.length; g++) {
              const peer = gameState.companies.get(comp.altGroupCompanyIds[g] | 0);
              if (peer && peer.altGroupId === comp.altGroupId) {
                peer.wantsToRun = false;
                peer.isRunning = false;
              }
            }
          }
          continue;
        }
        let anyMemberMoving = false;
        for (let m = 0; m < comp.memberIds.length; m++) {
          const mEnt = gameState.entities.get(comp.memberIds[m]);
          if (mEnt && mEnt.hp > 0 && (mEnt.isMoving || mEnt.animState === 1 || mEnt.animState === 2)) {
            anyMemberMoving = true;
            break;
          }
        }
        comp.wantsToRun = true;
        if (comp.isActivelyMoving() || anyMemberMoving) {
          comp.isRunning = true;
        }
      }
    } else if (type === CommandTypes.PLACE_BUILDING) {
      gameState.constructionSystem.createBuilding({
        type: payload.buildingType,
        team: (payload.team | 0) || 1,
        xFx: payload.xFx | 0,
        zFx: payload.zFx | 0,
        facingDir: payload.facingDir !== undefined ? payload.facingDir | 0 : null,
        workerCompanyIds: payload.workerCompanyIds || [],
        queueBuild: Boolean(payload.queue),
        instantComplete: false,
        gameState
      });
    } else if (type === CommandTypes.ASSIGN_BUILDERS) {
      gameState.constructionSystem.assignWorkerCompaniesToBuilding(
        payload.workerCompanyIds || [],
        payload.buildingId | 0,
        Boolean(payload.queue),
        gameState,
        Boolean(payload.isRunning)
      );
    } else if (type === CommandTypes.DEMOLISH_BUILDING) {
      const bIds = Array.isArray(payload.buildingIds)
        ? payload.buildingIds
        : [payload.buildingId | 0];
      for (let b = 0; b < bIds.length; b++) {
        gameState.constructionSystem.demolishBuilding(
          bIds[b] | 0,
          (payload.team | 0) || 1,
          gameState
        );
      }
    } else if (type === CommandTypes.QUEUE_PRODUCTION) {
      gameState.constructionSystem.queueProductionOption(
        payload.buildingId | 0,
        payload.optionId,
        (payload.team | 0) || 1
      );
    } else if (type === CommandTypes.CANCEL_PRODUCTION) {
      gameState.constructionSystem.cancelProductionOption(
        payload.buildingId | 0,
        payload.optionId,
        (payload.team | 0) || 1
      );
    } else if (type === CommandTypes.INSTANT_UPGRADE_BUILDING) {
      gameState.constructionSystem.instantUpgradeBuilding(
        payload.buildingId | 0,
        (payload.team | 0) || 1
      );
    } else if (type === CommandTypes.SET_BUILDING_RALLY) {
      const bIds = Array.isArray(payload.buildingIds)
        ? payload.buildingIds
        : [payload.buildingId | 0];
      for (let b = 0; b < bIds.length; b++) {
        gameState.constructionSystem.setBuildingRallyPoint(
          bIds[b] | 0,
          payload.xFx | 0,
          payload.zFx | 0,
          (payload.team | 0) || 1,
          gameState
        );
      }
    } else if (type === CommandTypes.GATHER_RESOURCE || type === CommandTypes.CHOP_TREE) {
      const targetTeam = (payload.team | 0) || 1;
      const workerIds = payload.workerCompanyIds || [0];
      gameState.economySystem.assignWorkerGatheringOrder(
        workerIds,
        payload.xFx | 0,
        payload.zFx | 0,
        targetTeam,
        gameState,
        Boolean(payload.queue),
        Boolean(payload.isRunning)
      );
    }
  }
}
