# Kings Lands — Codebase Map

**Updated to match the current modular architecture (including `UnitRenderer`, `UnitCollisionSystem`, `InputRouter`, multi-building selection, and Alt-relative formations).**

**Purpose:** help any developer or AI session navigate the actual code, discover existing APIs, follow ownership boundaries, and avoid inventing or duplicating interfaces.

> **Source-of-truth rule:** this map is a navigation aid, not a replacement for source code. Before changing a behavior or API, inspect the current implementation and its callers. Public exports listed here were verified against the current source snapshot.

## 1. Project snapshot

* Browser-based RTS / 3D engine using JavaScript ES modules, Three.js, and Vite.

* Package scripts: `npm run dev`, `npm run build`, `npm run preview`.

* Runtime dependency: `three`; build/dev dependency: `vite`.

* Main entry point: `src/main.js`.

* Simulation architecture: authoritative `GameState` stepped by `SimulationCore` at 20 TPS (`TICK_MS = 50`), normally inside `src/sim/worker.js`; main thread communicates through `SimBridge`.

* Rendering and UI run on the main thread.

* Source files: modular ES modules under `src/` enforcing Single Responsibility across simulation, rendering, input routing, and HUD, plus JSON configuration/data under `src/data/`.

## 2. High-level architecture

```
index.html
  └─ src/main.js
      ├─ CommandBus ──────────────── player/UI commands
      ├─ EventBus ────────────────── presentation notifications
      ├─ SimBridge
      │   ├─ Worker mode: src/sim/worker.js
      │   │   └─ SimulationCore
      │   │       └─ GameState
      │   │           ├─ commandHandlers.js (Command Dispatch)
      │   │           ├─ world/worldGen.js (Deterministic Trees & Mines)
      │   │           ├─ NavGrid / AStar / FlowFieldManager / SpatialHash
      │   │           ├─ MovementSystem
      │   │           │   ├─ UnitCombatSystem
      │   │           │   └─ UnitCollisionSystem
      │   │           ├─ EconomySystem
      │   │           └─ ConstructionSystem
      │   │               ├─ GarrisonSystem
      │   │               ├─ ProductionAndRallySystem
      │   │               └─ BuildingCombatSystem
      │   └─ local fallback (?noworker or Worker failure)
      ├─ SceneManager
      │   ├─ TerrainRenderer (consumes worldGen.js)
      │   ├─ CameraController (InputRouter layer priority 10)
      │   ├─ ModelFactory
      │   ├─ BuildingModelFactory
      │   │   └─ buildingArchitectures.js
      │   ├─ UnitRenderer (InstancedMesh batching, Actor Pool, Frustum Culling)
      │   │   └─ Animator3D
      │   ├─ WorldEffectsRenderer (Projectiles, FX Pulses, Floating Text)
      │   ├─ InputRouter (Priority-based DOM input dispatcher & blur recovery)
      │   ├─ FormationPreview3D (InputRouter layer priority 50)
      │   │   ├─ WorldPicker
      │   │   ├─ UnitSelectionController
      │   │   ├─ OrderQueueEngine
      │   │   ├─ OrderLineRenderer
      │   │   ├─ FormationGhostPreview (2D Ground Tactical Decals)
      │   │   └─ UnitTacticalOrb (HUD)
      │   ├─ BuildingRadialMenu (uses hudIcons.js; supports multi-building selection)
      │   ├─ WorkerPlacementController (InputRouter layer priority 100)
      │   │   ├─ WorldPicker (shared instance)
      │   │   ├─ TopResourceBar (HUD)
      │   │   └─ WorkerBuildChainMenu (HUD)
      │   └─ DevConsole (HUD)
      ├─ SynthAudio
      └─ StudioApp (separate 3D asset/animation authoring route)


```

### Ownership boundaries

* **Authoritative gameplay state:** `src/sim/gameState.js`, `src/sim/commandHandlers.js`, and simulation systems under `src/sim/systems/`. UI/rendering must request changes exclusively through serializable `CommandBus` commands.

* **Single deterministic world source:** `src/sim/world/worldGen.js` generates the exact Fixed-Point tree and mine lists consumed identically by `NavGrid`, `EconomySystem`, and `TerrainRenderer`.

* **Main-thread ↔ simulation boundary:** `SimBridge` and `worker.js`. Messages must remain serializable (`Int32Array` Transferable buffers + JSON metadata); never send Three.js objects, DOM elements, callbacks, or functions across it.

* **Instanced Unit & Pure FX Rendering:** `src/render/unitRenderer.js`, `src/render/orderLineRenderer.js`, and `src/render/worldEffectsRenderer.js` own GPU `InstancedMesh` batches, 3D dashed order/rally lines, click markers, projectiles, and floating texts without mutating gameplay rules.

* **Priority Input Routing & Client Order State:** `src/ui/input/inputRouter.js` dispatches pointer/keyboard events by layer priority (`building_placement` = 100, `unit_selection_orders` = 50, `camera` = 10), while `src/ui/input/` controllers translate interactions into `CommandBus` commands and maintain client-side visual queues (`OrderQueueEngine`) and raycasting (`WorldPicker`).

* **DOM HUD Components:** `src/ui/hud/` owns all HTML/SVG overlays, orbs, tooltips, and radial menus (`hudIcons.js`, `topResourceBar.js`, `workerBuildChainMenu.js`, `unitTacticalOrb.js`, `buildingRadialMenu.js`, `devConsole.js`).

* **Asset/animation tooling:** `src/tools/studio/` edits and previews visual/animation data; it is not the authoritative RTS simulation.

* **Configuration:** `src/data/{races,bases,shared}/**.json` (one identity card per race, assembled by `dataRegistry.js`; see `src/data/DATA_LAYOUT.md`); inspect actual consumers before adding or renaming fields. The sim is configured only through a frozen snapshot (`src/sim/simConfig.js`).

## 3. Recommended entry points for common tasks

| Task | Start here | Then inspect | 
| ----- | ----- | ----- | 
| Add/change a player command | `src/core/commandBus.js` | `src/sim/commandHandlers.js`, `src/sim/gameState.js`, UI caller | 
| Change authoritative rules, corpse decay, or tick order | `src/sim/gameState.js` | `src/sim/simulationCore.js`, relevant system | 
| Change movement, stamina, or group speed sync | `src/sim/systems/movementSystem.js` | `src/sim/formations/company.js`, `src/sim/nav/*` | 
| Change Boids separation or mass collision resolution | `src/sim/systems/unitCollisionSystem.js` | `src/sim/systems/movementSystem.js`, `src/sim/nav/spatialHash.js` | 
| Change unit target scanning or combat damage | `src/sim/systems/unitCombatSystem.js` | `src/sim/systems/movementSystem.js` | 
| Change formations, patrols, or company orders | `src/sim/formations/company.js` | `formations.js`, `armyDrag.js`, `formationPreview3D.js` | 
| Change multi-company drag layout or Alt-relative move | `src/sim/formations/armyDrag.js` | `movementSystem.js`, `formationGhostPreview.js`, `formationPreview3D.js` | 
| Change resources, gathering, drop-offs, or tree regrow | `src/sim/systems/economySystem.js` | `src/sim/world/worldGen.js`, `buildings.json` | 
| Change deterministic tree/mine placement | `src/sim/world/worldGen.js` | `nav/grid.js`, `economySystem.js`, `terrainRenderer.js` | 
| Change building placement, foundations, or repair | `src/sim/systems/constructionSystem.js` | `workerPlacementController.js`, `buildings.json` | 
| Change unit production, XP leveling, or Rally points | `src/sim/systems/productionAndRallySystem.js` | `constructionSystem.js`, `buildingRadialMenu.js` | 
| Change Watchtower garrison entry/exit | `src/sim/systems/garrisonSystem.js` | `constructionSystem.js`, `commandHandlers.js` | 
| Change tower turret firing, garrisoned archers, or auras | `src/sim/systems/buildingCombatSystem.js` | `constructionSystem.js`, `worldEffectsRenderer.js` | 
| Change GPU InstancedMesh unit rendering or frustum culling | `src/render/unitRenderer.js` | `modelFactory.js`, `animator3d.js`, `sceneManager.js` | 
| Change 3D order lines, rally lines, or click rings | `src/render/orderLineRenderer.js` | `src/ui/input/orderQueueEngine.js`, `sceneManager.js` | 
| Change client visual order queue or patrol staging | `src/ui/input/orderQueueEngine.js` | `formationPreview3D.js`, `orderLineRenderer.js` | 
| Change DOM input priority routing or blur handling | `src/ui/input/inputRouter.js` | `sceneManager.js`, `formationPreview3D.js`, `workerPlacementController.js` | 
| Change 3D picking / raycasting (trees, mines, units) | `src/ui/input/worldPicker.js` | `formationPreview3D.js`, `workerPlacementController.js` | 
| Change unit click/marquee/double-click/Ctrl selection | `src/ui/input/unitSelectionController.js` | `formationPreview3D.js` | 
| Change 2D ground tactical icon ghost preview | `src/ui/input/formationGhostPreview.js` | `formationPreview3D.js`, `armyDrag.js` | 
| Change unit tactical orb HUD (bottom-right) | `src/ui/hud/unitTacticalOrb.js` | `formationPreview3D.js`, `hudIcons.js` | 
| Change worker vertical build menu or top bar | `src/ui/hud/workerBuildChainMenu.js` / `topResourceBar.js` | `workerPlacementController.js`, `hudIcons.js` | 
| Change radial building menu or multi-building selection | `src/ui/hud/buildingRadialMenu.js` | `hudIcons.js`, `CommandBus`, `buildings.json` | 
| Change building 3D procedural architecture | `src/render/buildingArchitectures.js` | `src/render/buildingModelFactory.js` | 
| Change projectiles, level-up pillars, floating text | `src/render/worldEffectsRenderer.js` | `src/render/sceneManager.js` | 
| Change unit 3D models or carry props | `src/render/modelFactory.js` | `src/data/races/<race>/*.json` + `src/data/bases/*.json` (see `src/data/DATA_LAYOUT.md`), `animator3d.js` | 
| Change terrain visuals | `src/render/terrainRenderer.js` | `worldGen.js`, `nav/grid.js` | 
| Change camera controls | `src/render/cameraController.js` | `sceneManager.js`, `inputRouter.js`, `eventBus.js` | 

## 4. Public exports / module API catalog

### 4.1 Core (`src/core/`)

#### `src/core/commandBus.js`

* **Exports:** `CommandTypes`, `CommandBus`.

* **`CommandTypes`:** `MOVE_SQUAD`, `MOVE_COMPANIES`, `PATROL_COMPANIES`, `ATTACK_MOVE_COMPANIES`, `STOP_COMPANIES`, `SET_FORMATION`, `SET_COMPANY_GAIT`, `PLACE_BUILDING`, `ASSIGN_BUILDERS`, `DEMOLISH_BUILDING`, `QUEUE_PRODUCTION`, `CANCEL_PRODUCTION`, `INSTANT_UPGRADE_BUILDING`, `SET_BUILDING_RALLY`, `GARRISON_BUILDING`, `UNGARRISON_BUILDING`, `SET_TOWER_TARGET`, `DAMAGE_BUILDING_CHEAT`, `GATHER_RESOURCE`, `CHOP_TREE`, `DEV_CHEAT`, `SPAWN_PATROL_EVENT`, `PING_WORLD`, `RESET_PATROLS`.

* **`CommandBus` methods:** `setTransport(fn)`, `issue(type, payload = {}, issuedAtTick = 0)`, `flushOutgoing()`, `enqueueForSim(commands)`, `drainSimInbox()`.

#### `src/core/eventBus.js`

* **Exports:** `EventTypes`, `EventBus`.

* **`EventTypes`:** `SIM_SNAPSHOT`, `WORLD_EVENT`, `MODE_CHANGED`, `CAMERA_FOCUS_EVENT`, `SELECTION_CHANGED`, `ECONOMY_UPDATED`, `BUILDINGS_UPDATED`.

* **`EventBus` methods:** `on(eventType, callback)`, `off(eventType, callback)`, `emit(eventType, payload)`.

#### `src/core/fx.js`

* **Exports:**

  * **Constants:** `FX_SHIFT` (`10`), `FX_ONE` (`1024`), `FX_HALF` (`512`), `TICK_MS` (`50`), `TICKS_PER_SEC` (`20`), `PERMILLE_ONE` (`1000`), `ANGLE_STEPS` (`1024`), `ANGLE_MASK` (`1023`), `ANGLE_QUARTER` (`256`), `ANGLE_HALF` (`512`).

  * **Functions:** `toFx`, `toFloat`, `mulDiv`, `fxMul`, `fxDiv`, `fxPermille`, `fxAbs`, `fxClamp`, `isqrt`, `fxSqrt`, `fxHypot`, `fxSin`, `fxCos`, `fxAtan2`, `xorshift32`, `fxRandomRange`.

### 4.2 Simulation, World & Navigation (`src/sim/`)

#### `src/sim/gameState.js`

* **Exports:** `TileType`, `AnimState`, `UnitTypeIndex`, `IndexToUnitType`, `SNAPSHOT_STRIDE` (`8`), `CORPSE_DECAY_TICKS` (`200`), `GameState`, plus re-exports `computeRiverCenterZFx`, `isOnBridgeFx`, `sampleTerrainHeightFx`, `classifyTileTypeFx`.

* **`GameState` methods:** `processCommands(commands)`, `recordWorldEvent(fxX, fxY, fxZ, label)`, `stepTick(commands = [])`, `computeStateHash()`, `packSnapshot(measuredTpsPermille, reusedMetaBuffer, reusedEntityBuffer)`.

#### `src/sim/commandHandlers.js`

* **Exports:**

  * `resolveTargetCompanies(gameState, team, companyIds)`

  * `applyHalfDamageCheat(gameState, team = 1, buildingId = null)`

  * `processSimCommands(gameState, commands)` — authoritative command dispatcher called by `GameState.processCommands()`. Propagates `queue` (Shift), `isRunning` (double-right-click), `preserveRelative` (Alt), and multi-building arrays (`buildingIds`) to movement, economy, construction, and garrison systems.

#### `src/sim/world/worldGen.js`

* **Exports:**

  * `AUTHORITATIVE_MINE_SPECS` — frozen array of all 14 mine definitions `{ id, x, z, type }`.

  * `generateDeterministicTreesFx(config = {}, worldSizeMeters = 1024)` — returns deterministic array of `{ id, xFx, yFx, zFx, scalePermille }`.

  * `generateDeterministicMinesFx(worldSizeMeters = 1024)` — returns deterministic array of `{ id, resourceType, xFx, yFx, zFx }`.

#### `src/sim/simulationCore.js`, `src/sim/worker.js`, `src/sim/simBridge.js`

* **`SimulationCore`:** `receiveCommands(commands)`, `recycleBuffers(metaBuffer, entityBuffer)`, `start()`, `stop()`.

* **`SimBridge`:** `start()`, `stop()`, `setNoWorkerMode(useNoWorker)`, `getEconomyState()`, `getInterpolatedBuildings()`, `getInterpolatedState(nowMs)`.

#### `src/sim/nav/grid.js`

* **Exports:** `NavTileType`, `TerrainSpeedPermille`, `TerrainBaseCost`, `computeRiverCenterZFx`, `isOnBridgeFx`, `isOnWalkableBridgeDeckFx`, `isOnBridgeSideWallFx`, `isInShallowFordZoneFx`, `sampleTerrainHeightFx`, `classifyTileTypeFx`, `NavGrid`.

#### `src/sim/nav/astar.js`, `flowField.js`, `spatialHash.js`

* **`AStar`:** `findPath(startFxX, startFxZ, goalFxX, goalFxZ, options = {})`.

* **`FlowField` / `FlowFieldManager`:** `clearCache()`, `getOrCreateFlowField(...)`, `getFlowFieldByKey(...)`.

* **`SpatialHash`:** `clear()`, `rebuild(entitiesMap, sortedEntityIds)`, `insert(entityId, xFx, zFx)`, `queryRadiusIds(xFx, zFx, radiusFx, entitiesMap, outIds = [])`.

#### `src/sim/formations/company.js`, `formations.js`, `armyDrag.js`

* **`company.js`:** `PATROL_LOOP_SNAP_RADIUS_FX`, `RUN_STAMINA_THRESHOLD_PERMILLE` (`700`), `WORKER_FATIGUE_THRESHOLD_PERMILLE` (`300`), `CompanyOrderType`, `CompanyRole`, `resolveCompanyRole`, `resolveDefaultFormation`, `Company`.

  * **`Company` methods:** `isActivelyMoving()`, `canStartRunning()`, `clearPatrolIfActive()`, `syncCasualtiesAndPromoteRear(entitiesMap)`, `setFormation(requestedFormation, navGrid, entitiesMap)`, `enqueueOrSetOrder(orderDescriptor, appendQueue, astar, navGrid, entitiesMap)`, `advanceCommandQueue(astar, navGrid, entitiesMap)`, `advancePatrolWaypoint()`, `updateSlotTargets(navGrid, entitiesMap)`, `stopInPlace(navGrid, entitiesMap, preserveWorkSlots = false)`.

* **`formations.js`:** `FormationTypes`, `AllowedFormationsByUnitType`, `getAllowedFormationsForUnit`, `isFormationAllowedForUnit`, `sanitizeFormationForUnit`, `FormationSpacingConfigFx`, `computeFormationLocalSlotsFx`, `transformLocalSlotToWorldFx`, `measureChokepointSqueezePermille`.

* **`armyDrag.js`:** `computeArmyDragLayoutFx(companyDescriptors, dragStartFx, dragEndFx, navGrid = null, options = {})` — supports multi-rank tactical cube wrapping and `options.preserveRelative` (Alt-move / Alt-drag group rotation).

### 4.3 Simulation Systems (`src/sim/systems/`)

#### `src/sim/systems/movementSystem.js`

* **Exports:** `UnitPhysicsProfile`, `MovementSystem`.

* **Key methods:** `getPhysicsProfile(unitTypeIdx)`, `issueArmyDragOrder(companies, entitiesMap, dragStartFx, dragEndFx, orderType, currentTick, options)`, `assignUnitAStarRoute(ent, targetXFx, targetZFx)`, `update(gameState, { AnimState, UnitTypeIndex })`.

* Collaborates with `UnitCombatSystem` (`this.combatSystem`) and `UnitCollisionSystem` (`this.collisionSystem`).

#### `src/sim/systems/unitCollisionSystem.js`

* **Exports:** `UnitCollisionSystem`.

* **Methods:**

  * `computeBoidsSeparationFx(ent, prof, entitiesMap)`

  * `resolveMassCollisions(entitiesMap, sortedIds, worldMinFx, worldMaxFx)`

#### `src/sim/systems/unitCombatSystem.js`

* **Exports:** `UnitCombatSystem`.

* **Methods:**

  * `findNearestEnemyEntity(xFx, zFx, scanRadiusFx, myTeam, entitiesMap)`

  * `evaluateCompanyCombatEngagement(comp, prof, entitiesMap)`

  * `stepUnitCombat(ent, comp, prof, gameState, { AnimState, UnitTypeIndex })`

#### `src/sim/systems/economySystem.js`

* **Exports:** `ResourceTypes`, `CarryPropCode`, `resourceTypeToCarryCode`, `TreeState`, `GathererState`, `EconomySystem`.

* **Key methods:** `isOverlappingResourceNode(xFx, zFx, footprintRadiusFx)`, `getTeamLedger(team)`, `grantCheatResources(team, amount)`, `sanitizeCostForCategory(...)`, `canAfford(...)`, `spendResources(...)`, `refundResources(...)`, `addResource(...)`, `findNearestGrownTree(...)`, `findNearestMine(...)`, `assignWorkerGatheringOrder(workerCompanyIds, targetXFx, targetZFx, team, gameState, queue = false, isRunning = false)`, `cancelGatheringForCompanies(...)`, `getDepletedTreeIds()`, `update(...)`.

#### `src/sim/systems/constructionSystem.js`

* **Exports:** `MAX_SLOPE_HEIGHT_DIFF_FX`, `CITADEL_SLOT_RING_RADIUS_FX`, `ConstructionSystem`.

* Owns foundation placement, `workerBuildQueues`, single-squad construction locking, perimeter builder slot assignment, construction/repair progress, and building demolition.

* Composes and delegates to:

  * `this.garrisonSystem` (`GarrisonSystem`)

  * `this.productionSystem` (`ProductionAndRallySystem`)

  * `this.combatSystem` (`BuildingCombatSystem`)

* **Facade methods preserved on `ConstructionSystem`:** `spawnStartingCitadels()`, `isPlacementValid(...)`, `createBuilding(...)`, `assignWorkerCompaniesToBuilding(workerCompanyIds, buildingId, appendQueue = false, gameState = null, isRunning = false)`, `demolishBuilding(...)`, `orderCompaniesToGarrison(companyIds, buildingId, team, gameState, queue = false, isRunning = false)`, `ungarrisonBuilding(...)`, `setTowerManualTarget(...)`, `setBuildingRallyPoint(...)`, `getInstantUpgradeCostCoins(...)`, `addBuildingXp(...)`, `instantUpgradeBuilding(...)`, `queueProductionOption(...)`, `cancelProductionOption(...)`, `update(gameState, { AnimState, UnitTypeIndex })`.

#### `src/sim/systems/garrisonSystem.js`

* **Exports:** `GarrisonSystem`.

* **Methods:** `orderCompaniesToGarrison(companyIds, buildingId, team, gameState, queue = false, isRunning = false)` (supports waiting outside uncompleted towers until built), `ungarrisonBuilding(buildingId, team, gameState, targetCompanyId = null)`, `stepBuildingGarrisonExits(gameState, building, AnimState)`, `processPendingGarrisonOrders(gameState)`.

#### `src/sim/systems/productionAndRallySystem.js`

* **Exports:** `ProductionAndRallySystem`.

* **Methods:** `setBuildingRallyPoint(buildingId, rallyXFx, rallyZFx, team = 1, gameState = null)`, `getInstantUpgradeCostCoins(building)`, `addBuildingXp(building, xpAmount)`, `levelUpBuilding(building, def)`, `instantUpgradeBuilding(buildingId, team = 1)`, `queueProductionOption(buildingId, optionId, team = 1)`, `cancelProductionOption(buildingId, optionId, team = 1)`, `startSequentialCompanySpawn(gameState, building, item, UnitTypeIndex)`, `executeSmartRallyActionForCompany(gameState, building, comp)`, `stepBuildingDoorSpawns(gameState, building, AnimState)`, `stepBuildingProduction(gameState, building, UnitTypeIndex)`, `flushPendingLevelUpEvents(gameState)`.

#### `src/sim/systems/buildingCombatSystem.js`

* **Exports:** `BuildingCombatSystem`.

* **Methods:** `setTowerManualTarget(buildingId, targetEntityId, team = 1)`, `stepBuildingTurretAndAuras(gameState, b, AnimState, UnitTypeIndex)` (includes individual garrisoned archer firing with `+6m` elevation bonus and squad-locked manual focus fire).

### 4.4 Rendering (`src/render/`)

#### `src/render/sceneManager.js`

* **Exports:** `SceneManager`.

* Coordinates Three.js scene, lighting, `TerrainRenderer`, `CameraController`, `ModelFactory`, `BuildingModelFactory`, `UnitRenderer`, `WorldEffectsRenderer`, `FormationPreview3D`, `BuildingRadialMenu`, `WorkerPlacementController`, `InputRouter`, and `DevConsole`.

* **Public methods:** `flashBuilding(buildingId, mode = 'command')`, `start()`.

#### `src/render/unitRenderer.js`

* **Exports:** `UnitRenderer`.

* Converts all procedural unit hierarchy meshes, company banners, worker carry props, and selection rings into dynamic GPU `THREE.InstancedMesh` batches (`InstancedPartBatch`), with actor pooling and camera frustum culling.

* **Public methods:** `update(entities, dtSeconds, formationPreview)`.

#### `src/render/orderLineRenderer.js`

* **Exports:** `ORDER_LINE_COLORS`, `OrderLineRenderer`.

* Pure presentation renderer for terrain-conforming dashed lines and ephemeral click markers (`frustumCulled = false`).

* **Methods:** `sampleExactGroundY(xMeters, zMeters)`, `buildTerrainConformingSegmentPoints(x0, z0, x1, z1, yOffset = 0.35)`, `spawnEphemeralClickMarker(worldPoint, orderType = 'MOVE', radiusScale = 1.0)`, `updateEphemeralMarkers(dtSeconds)`, `clearLines()`, `renderSegments(segments)`.

#### `src/render/worldEffectsRenderer.js`

* **Exports:** `WorldEffectsRenderer`.

* Owns world FX pulses, resource gather rings (`RESOURCE_PING`), building level-up pillars, floating resource drop-off texts, tower projectiles, animator hit sparks, and the hovered building HP badge.

* **Methods:** `spawnResourceGatherPing(ev)`, `spawnBuildingLevelUpAnimation(ev)`, `spawnFloatingResourceText(ev)`, `spawnTowerShotVisuals(ev)`, `spawnAnimatorEventSpark(evt)`, `updateHoverBuildingBadge(hoveredBuildingObj)`, `update(dtSeconds)`.

#### `src/render/buildingModelFactory.js` & `src/render/buildingArchitectures.js`

* **`buildingArchitectures.js` exports:** `BUILDINGS_WITH_DOORS`, `STONE_WALL_BUILDINGS`, `addCourtyardGateFence`, `addBuildingDoorway`, `populateArchitectureByType`.

* **`BuildingModelFactory` exports:** `BuildingModelFactory` with `createOccludedDashedRingMesh(...)`, `setBuildingSelectHighlight(actor, intensity)`, `createBuildingActor(bld, options = {})`, `createMineOutcropMesh(mine)`, `createRallyFlagMesh()`.

#### `src/render/modelFactory.js`, `animator3d.js`, `terrainRenderer.js`, `cameraController.js`

* **`ModelFactory` & `AssetAdapter`:** unit visual hierarchy, shared geometry/material caches, team palettes, banners, and worker carry props (`setWorkerCarryProp`).

* **`Animator3D`:** zero-allocation procedural locomotion (`walk`, `run`, `gallop`, `worker_build`, `worker_gather`, `spear_wall_idle`), keyframe upper/full-body clips, and automatic corpse pose-locking (`poseLocked`).

* **`TerrainRenderer`:** terrain mesh, water plane, stone bridge, and deterministic trees/mines via `worldGen.js`.

* **`CameraController`:** WASD/Arrows, edge pan, wheel zoom, Alt+Left-Drag / Middle-Drag orbit, and spacebar focus.

### 4.5 Input & Client Order Engine (`src/ui/input/`)

#### `src/ui/input/inputRouter.js`

* **Exports:** `InputRouter`.

* Priority-based DOM event router (`registerLayer(id, handler, priority = 0)`) that dispatches `mousedown`, `mousemove`, `mouseup`, `dblclick`, `wheel`, `keydown`, `keyup`, `mouseenter`, `mouseleave`, and automatic window `blur` / `visibilitychange` resets.

#### `src/ui/input/formationPreview3D.js`

* **Exports:** `FormationPreview3D`.

* Coordinates `WorldPicker`, `UnitSelectionController`, `OrderQueueEngine`, `OrderLineRenderer`, `FormationGhostPreview`, and `UnitTacticalOrb`.

* **Methods:** `onWindowBlur()`, `isCompanySelected(companyId)`, `getSelectedWorkerCompanyIds()`, `clearSelection()`, `cancelRightDrag()`, `spawnEphemeralClickMarker(worldPoint, orderType, radiusScale)`, `notifyWorkerGatherOrder(workerCompanyIds, resourceX, resourceZ, queueShift, isRunning)`, `notifyWorkerDropoffOrder(workerCompanyIds, campX, campZ, queueShift, isRunning)`, `notifyGarrisonOrder(companyIds, towerX, towerZ, queueShift, isRunning)`, `notifyWorkerBuildOrder(workerCompanyIds, targetX, targetZ, queueShift, isRunning)`, `setTargetingMode(mode)`, `toggleSelectedGait(forceRun = null)`, `cycleSelectedFormation()`, `issueStopCommand()`, `update(dtSeconds)`.

#### `src/ui/input/orderQueueEngine.js`

* **Exports:** `OrderQueueEngine`.

* Maintains client-side visual order queues per company and produces pure segment arrays for `OrderLineRenderer`.

* **Methods:** `clearAllForCompanies(companyIds)`, `clearStagedPatrol()`, `hasStagedPatrol()`, `hasActiveVisualOrder(companyId)`, `enqueueGatherOrder(workerCompanyIds, resourceX, resourceZ, queueShift)`, `enqueueDropoffOrder(workerCompanyIds, campX, campZ, queueShift)`, `enqueueGarrisonOrder(companyIds, towerX, towerZ, queueShift)`, `enqueueBuildOrder(workerCompanyIds, targetX, targetZ, queueShift)`, `stageShiftPatrolPoint(worldPoint, descriptors)`, `consumeStagedPatrolRoute(descriptors)`, `enqueuePlacementOrders(...)`, `syncAndBuildSegments(...)`.

#### `src/ui/input/worldPicker.js`

* **Exports:** `WorldPicker`.

* Unified raycasting and O(1) spatial lookup helper shared by `FormationPreview3D` and `WorkerPlacementController`.

* **Methods:** `raycastTerrain(mouseEvent)`, `ensureTreeCoordsCached()`, `overlapsResourceNodeClient(xMeters, zMeters, footprintRadiusMeters)`, `findResourceNodeAtMouse(mouseEvent, terrainHitPoint)`, `findBuildingNear(xMeters, zMeters, marginMeters = 0.5)`, `findEnemyEntityNearWorldPoint(xMeters, zMeters, maxRadiusMeters = 1.35)`, `findNearestUnitOnScreen(clientX, clientY, teamFilter = 1, maxPixelRadius = 26)`.

#### `src/ui/input/unitSelectionController.js`

* **Exports:** `SAME_TYPE_SELECT_RADIUS_METERS` (`65`), `UnitSelectionController`.

* **Methods:** `showMarqueeRect(x0, y0, x1, y1)`, `hideMarquee()`, `isCompanySelected(companyId)`, `gatherFriendlyCompanies()`, `getSelectedWorkerCompanyIds(friendlyMap)`, `buildSelectedCompanyDescriptors(friendlyMap)`, `emitSelectionChanged(friendlyMap)`, `pruneMissingSelections(friendlyMap)`, `selectCompanyByClick(clientX, clientY, additiveShift)`, `selectCompaniesInMarquee(minX, minY, maxX, maxY, additiveShift)`, `selectAllOfSameUnitType(clientX, clientY, additiveShift = false)`.

#### `src/ui/input/formationGhostPreview.js`

* **Exports:** `FormationGhostPreview`.

* Renders 2D ground tactical icon `InstancedMesh` decals (`swordsman`, `spearman`, `archer`, `cavalry`, `worker`, `default`) and `unifiedArmyArrow` when right-dragging (`dragDist >= 2.0m`).

* **Methods:** `hide()`, `update(dragStartWorld, dragCurrentWorld, descriptors, preserveRelative = false)`.

#### `src/ui/input/workerPlacementController.js`

* **Exports:** `WorkerPlacementController`.

* Owns 3D building placement ghost preview, wheel/drag rotation, placement validation, building selection (click, Shift+click, Double-click/Ctrl+click same type), and contextual right-click actions (manual tower target, smart rally point for single or multiple buildings, Shift-gather, resource drop-off, Shift/double-click build/repair, and Watchtower garrison).

* Composes `TopResourceBar` and `WorkerBuildChainMenu`.

* **Methods:** `onWindowBlur()`, `startPlacementMode(buildingType)`, `cancelPlacementMode()`, `update()`.

### 4.6 HUD & DOM Overlays (`src/ui/hud/`)

#### `src/ui/hud/hudIcons.js`

* **Exports:** `FORMATION_SVG_ICONS`, `BUILDING_SVG_ICONS`, `OPTION_SVG_ICONS`, `buildOrbDecorationsSvg(archPath)`.

#### `src/ui/hud/topResourceBar.js`

* **Exports:** `TopResourceBar`.

* **Methods:** `update(eco)`.

#### `src/ui/hud/workerBuildChainMenu.js`

* **Exports:** `WorkerBuildChainMenu`.

* **Methods:** `setVisible(visible)`, `refreshStyles(activePlacementType)`.

#### `src/ui/hud/unitTacticalOrb.js`

* **Exports:** `UnitTacticalOrb`.

* **Methods:** `refreshFormationButtonOnly(selectedList, companyFormations)`, `refresh({ selectedList, ecoStates, companyFormations, targetingMode, isMovingNow, wantsToRunNow, isActuallyRunningNow })`.

#### `src/ui/hud/buildingRadialMenu.js`

* **Exports:** `BuildingRadialMenu`.

* Supports single and multi-building selection (`selectedBuildingIds`), load-balanced production queuing across selected buildings, and zero-DOM-churn live HP/progress updates.

* **Methods:** `isBuildingSelected(buildingId)`, `openForBuilding(buildingId, additiveShift = false)`, `selectBuildingsOfSameTypeNear(buildingId, additiveShift = false, radiusMeters = 75)`, `close()`, `getSelectedBuildings()`, `getSelectedBuildingIds()`, `getSelectedBuilding()`, `update()`.

#### `src/ui/hud/devConsole.js`

* **Exports:** `DevConsole`.

* **Methods:** `open()`, `close()`.

## 5. Important contracts and footguns

1. **Fixed-point units:** simulation positions and distances use integer fixed-point (`FX_ONE = 1024`). Camera and render APIs use meters/floats. Never mix them without explicit `toFx()` / `toFloat()` conversion.

2. **Simulation rate:** 20 ticks/sec (`TICK_MS = 50`). Simulation timers must be tick-based.

3. **Determinism:** no `Math.random()`, wall-clock time, or native floating-point trig in authoritative simulation. Use `xorshift32` / `fxRandomRange`, lookup tables in `fx.js`, and `worldGen.js`.

4. **State ownership:** never mutate `GameState` from rendering/UI. Issue commands via `CommandBus`.

5. **Instanced Unit Rendering:** `UnitRenderer` detaches leaf `THREE.Mesh` objects from individual unit rigs and renders them via `THREE.InstancedMesh` batches. Do not rely on `mesh.visible` inside unit rigs at runtime; visibility and categories (`body`, `banner`, `carry_1..4`, `ring`) are controlled via instance matrix pushing in `UnitRenderer.update()`.

6. **Line & Flag Frustum Culling:** dynamic world-space lines (`OrderLineRenderer`, `rallyLineMesh`) must keep `frustumCulled = false` so long lines never vanish when their origin leaves the camera frustum.

7. **Rally Point Enemy Snapping:** keep enemy unit snap tolerance tight (`~1.4m` client / `2253 fx` (`~2.2m`) sim) in both `WorkerPlacementController` and `ProductionAndRallySystem.setBuildingRallyPoint` so ground rally flags never snap to distant enemies.

# מפת הפרויקט המלאה ומדריך כל הפונקציות — Kings Lands

מסמך זה ממפה את כל **100 מודולי ה-JavaScript**, קבצי הנתונים (`src/data/`), ו-**7 תיקיות הטסטים האוטומטיים (`tests/`)**, כולל פירוט של **כל הפונקציות והמתודות בכל קובץ ומה כל אחת עושה**.

## סיכום מבנה התיקיות

* `src/core/` — מתמטיקת נקודה-קבועה דטרמיניסטית (`fx.js`), ערוץ פקודות (`commandBus.js`) וערוץ אירועים (`eventBus.js`).

* `src/sim/` — ליבת הסימולציה ב-20 TPS, ניווט A\* ושדות זרימה, מבני פלוגות, מערכות קרב/כלכלה/בנייה/גיבורים, ומוח ה-AI (`src/sim/ai/`).

* `src/render/` — מנוע הרינדור ב-Three.js, דגימת Keyframes ואנימציה פרוצדורלית (`animator3d.js`, `keyframeSampler.js`), איחוד InstancedMesh (`unitInstancingBatcher.js`) ואפקטי לחשים.

* `src/ui/` — קלט ובחירה תלת-ממדית (`worldPicker.js`), גרירת מבנים (`formationPreview3D.js`), סמני עכבר (`cursorSystem.js`), מיני-מפה ותפריטים מעגליים.

* `src/tools/` — היכל הגיבורים (`src/tools/heroes/`) ומעבדת האנימציות התלת-ממדית (`src/tools/studio/`).

* `tests/` — מערך בדיקות אוטומטי ממודר ב-7 תיקיות (`core`, `movement`, `combat`, `economy`, `ai`, `render`, `ui`).

## 1. נקודת כניסה, ליבה ואודיו (`src/main.js`, `src/core/`, `src/audio/`)

### `src/audio/synthAudio.js`

**תפקיד הקובץ:** סינתיסייזר סאונד פרוצדורלי מבוסס Web Audio API ליצירת צלילי חרבות, חיצים, קרנות מלחמה, קסמים והתראות ממשק.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor()` | 2 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_ensureCtx()` | 6 | פונקציית עזר ולוגיקה ייעודית במודול (`_ensureCtx`). | 
| `playHornAlert()` | 17 | פונקציית עזר ולוגיקה ייעודית במודול (`playHornAlert`). | 
| `playFocusWhoosh()` | 34 | פונקציית עזר ולוגיקה ייעודית במודול (`playFocusWhoosh`). | 

### `src/core/commandBus.js`

**תפקיד הקובץ:** תור פקודות מרכזי (`CommandBus`) המעביר פקודות שחקן ופקודות AI בצורה אחידה אל מנוע הסימולציה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor()` | 33 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `setTransport(fn)` | 39 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setTransport`). | 
| `flushOutgoing()` | 54 | פונקציית עזר ולוגיקה ייעודית במודול (`flushOutgoing`). | 
| `enqueueForSim(commands)` | 59 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`enqueueForSim`). | 
| `drainSimInbox()` | 67 | פונקציית עזר ולוגיקה ייעודית במודול (`drainSimInbox`). | 

### `src/core/eventBus.js`

**תפקיד הקובץ:** מערכת אירועים פנימית (`EventBus`) לתקשורת בין הסימולציה, שכבת התצוגה (`SceneManager`) וה-HUD.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor()` | 12 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `on(eventType, callback)` | 16 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`on`). | 
| `off(eventType, callback)` | 24 | פונקציית עזר ולוגיקה ייעודית במודול (`off`). | 
| `emit(eventType, payload)` | 31 | פונקציית עזר ולוגיקה ייעודית במודול (`emit`). | 

### `src/core/fx.js`

**תפקיד הקובץ:** ספריית מתמטיקת נקודה-קבועה (Fixed-Point `FX_ONE = 1024`) ו-PRNG דטרמיניסטי (`xorshift32`) להבטחת סימולציה זהה ב-100% בכל הרצה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `toFx(meters)` | 50 | פונקציית עזר ולוגיקה ייעודית במודול (`toFx`). | 
| `toFloat(fxValue)` | 51 | פונקציית עזר ולוגיקה ייעודית במודול (`toFloat`). | 
| `mulDiv(a, b, c)` | 53 | פונקציית עזר ולוגיקה ייעודית במודול (`mulDiv`). | 
| `fxMul(a, b)` | 62 | פונקציית עזר ולוגיקה ייעודית במודול (`fxMul`). | 
| `fxDiv(a, b)` | 63 | פונקציית עזר ולוגיקה ייעודית במודול (`fxDiv`). | 
| `fxPermille(value, permille)` | 64 | פונקציית עזר ולוגיקה ייעודית במודול (`fxPermille`). | 
| `fxAbs(v)` | 65 | פונקציית עזר ולוגיקה ייעודית במודול (`fxAbs`). | 
| `fxClamp(v, minVal, maxVal)` | 66 | פונקציית עזר ולוגיקה ייעודית במודול (`fxClamp`). | 
| `isqrt(n)` | 71 | בדיקת תנאי בוליאני או תקינות מצב (`isqrt`). | 
| `isqrtExactNumber(n)` | 93 | בדיקת תנאי בוליאני או תקינות מצב (`isqrtExactNumber`). | 
| `fxSqrt(fxVal)` | 102 | פונקציית עזר ולוגיקה ייעודית במודול (`fxSqrt`). | 
| `fxHypot(dx, dz)` | 111 | פונקציית עזר ולוגיקה ייעודית במודול (`fxHypot`). | 
| `fxSin(angleIdx)` | 118 | פונקציית עזר ולוגיקה ייעודית במודול (`fxSin`). | 
| `fxCos(angleIdx)` | 119 | פונקציית עזר ולוגיקה ייעודית במודול (`fxCos`). | 
| `fxSinSub(angleSub10)` | 121 | פונקציית עזר ולוגיקה ייעודית במודול (`fxSinSub`). | 
| `fxCosSub(angleSub10)` | 130 | פונקציית עזר ולוגיקה ייעודית במודול (`fxCosSub`). | 
| `fxSmoothstepPermille(tPermille)` | 134 | פונקציית עזר ולוגיקה ייעודית במודול (`fxSmoothstepPermille`). | 
| `fxAtan2(dy, dx)` | 140 | פונקציית עזר ולוגיקה ייעודית במודול (`fxAtan2`). | 
| `xorshift32(gameState)` | 161 | פונקציית עזר ולוגיקה ייעודית במודול (`xorshift32`). | 
| `fxRandomRange(gameState, minIncl, maxIncl)` | 173 | פונקציית עזר ולוגיקה ייעודית במודול (`fxRandomRange`). | 

### `src/main.js`

**תפקיד הקובץ:** נקודת הכניסה הראשית של האפליקציה — ניהול נתיבים (משחק ראשי, מעבדת אנימציות, היכל הגיבורים), אתחול שדה הקרב (`initBattlefieldApp`) וניקוי זיכרון ו-WebGL במעבר בין מסכים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `isStudioRoute()` | 17 | בדיקת תנאי בוליאני או תקינות מצב (`isStudioRoute`). | 
| `isHeroesRoute()` | 23 | בדיקת תנאי בוליאני או תקינות מצב (`isHeroesRoute`). | 
| `getOrCreateRootContainer(id)` | 29 | שליפת נתונים או מצב נוכחי (`getOrCreateRootContainer`). | 
| `destroyActiveLabs()` | 39 | ניקוי משאבים, מאזינים וזיכרון עבור `destroyActiveLabs`. | 
| `launchStudio(options = {})` | 57 | פונקציית עזר ולוגיקה ייעודית במודול (`launchStudio`). | 
| `launchHallOfHeroes(options = {})` | 108 | פונקציית עזר ולוגיקה ייעודית במודול (`launchHallOfHeroes`). | 
| `ensureToolsButtonsWired(simBridge)` | 143 | פונקציית עזר ולוגיקה ייעודית במודול (`ensureToolsButtonsWired`). | 
| `initBattlefieldApp()` | 205 | אתחול והקמת הרכיבים עבור `initBattlefieldApp`. | 
| `isTextInputFocused()` | 244 | בדיקת תנאי בוליאני או תקינות מצב (`isTextInputFocused`). | 
| `boot()` | 333 | פונקציית עזר ולוגיקה ייעודית במודול (`boot`). | 

## 2. מנוע הסימולציה, ניווט ומבנים (`src/sim/`, `src/sim/nav/`, `src/sim/formations/`, `src/sim/world/`)

### `src/sim/commandHandlers.js`

**תפקיד הקובץ:** פענוח וביצוע של כל סוגי הפקודות (`processSimCommands`) כולל תנועה, בנייה, גיוס, לחשים ופקודות קונסול.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `resolveTargetCompanies(gameState, team, companyIds)` | 6 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveTargetCompanies`). | 
| `applyHalfDamageCheat(gameState, team = 1, buildingId = null)` | 23 | הגדרה והחלה של ערכים או פקודות על האובייקט (`applyHalfDamageCheat`). | 
| `processSimCommands(gameState, commands)` | 40 | פונקציית עזר ולוגיקה ייעודית במודול (`processSimCommands`). | 

### `src/sim/formations/armyDrag.js`

**תפקיד הקובץ:** חישוב פריסת מספר פלוגות בקו גרירה או בשמירה על מבנה יחסי (`Alt`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `projectLocal(desc)` | 247 | פונקציית עזר ולוגיקה ייעודית במודול (`projectLocal`). | 
| `sortGroupSpatially(arr, colsPerRow)` | 259 | פונקציית עזר ולוגיקה ייעודית במודול (`sortGroupSpatially`). | 

### `src/sim/formations/company.js`

**תפקיד הקובץ:** מחלקת הפלוגה (`Company`) — ניהול חיילי הפלוגה, תור פקודות, סיור, התאמת משבצות (`updateSlotTargets`), קבוצות `Alt` ואיפוס ריצה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `resolveCompanyRole(unitType)` | 48 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveCompanyRole`). | 
| `resolveDefaultFormation(_unitType)` | 59 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveDefaultFormation`). | 
| `isActivelyMoving()` | 163 | בדיקת תנאי בוליאני או תקינות מצב (`isActivelyMoving`). | 
| `canStartRunning()` | 173 | בדיקת תנאי בוליאני או תקינות מצב (`canStartRunning`). | 
| `clearPatrolIfActive()` | 183 | איפוס, ביטול או הסרה של נתונים ישנים (`clearPatrolIfActive`). | 
| `syncCasualtiesAndPromoteRear(entitiesMap)` | 203 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`syncCasualtiesAndPromoteRear`). | 
| `setFormation(requestedFormation, navGrid, entiti...)` | 263 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setFormation`). | 
| `_evaluatePatrolLoopClosure()` | 290 | דגימה וחישוב ערך בנקודה או בזמן נתון (`_evaluatePatrolLoopClosure`). | 
| `enqueueOrSetOrder(orderDescriptor, appendQueue, astar...)` | 310 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`enqueueOrSetOrder`). | 
| `advanceCommandQueue(astar, navGrid, entitiesMap)` | 441 | פונקציית עזר ולוגיקה ייעודית במודול (`advanceCommandQueue`). | 
| `advancePatrolWaypoint()` | 605 | פונקציית עזר ולוגיקה ייעודית במודול (`advancePatrolWaypoint`). | 
| `assignSingleReinforcedUnitSlot(newEnt, navGrid, entitiesMap)` | 633 | הגדרה והחלה של ערכים או פקודות על האובייקט (`assignSingleReinforcedUnitSlot`). | 
| `updateSlotTargets(navGrid, entitiesMap)` | 696 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`updateSlotTargets`). | 
| `stopInPlace(navGrid, entitiesMap, preserveWorkS...)` | 928 | עצירת פעילות ואיפוס מצב התנועה/הריצה ב-`stopInPlace`. | 

### `src/sim/formations/formations.js`

**תפקיד הקובץ:** חישוב גאומטרי של משבצות מבנה (`SQUARE`, `WEDGE`, `SPEAR_WALL`, `PIKE_PHALANX`) והתכווצות דינמית במעברים צרים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `getAllowedFormationsForUnit(unitType)` | 33 | שליפת נתונים או מצב נוכחי (`getAllowedFormationsForUnit`). | 
| `isFormationAllowedForUnit(unitType, formationType)` | 37 | בדיקת תנאי בוליאני או תקינות מצב (`isFormationAllowedForUnit`). | 
| `sanitizeFormationForUnit(unitType, requestedFormation)` | 42 | פונקציית עזר ולוגיקה ייעודית במודול (`sanitizeFormationForUnit`). | 
| `buildCenterOutwardColumnOffsetsFx(colsInRank, spacingXFx)` | 82 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildCenterOutwardColumnOffsetsFx`). | 

### `src/sim/gameState.js`

**תפקיד הקובץ:** ניהול מצב המשחק המלא (`GameState`) — איחוד כל מערכות הסימולציה, הרצת `stepTick`, אריזת Snapshots וחישוב Hash דטרמיניסטי.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(config)` | 95 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_spawnInitialSquads()` | 159 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`_spawnInitialSquads`). | 
| `processCommands(commands)` | 280 | פונקציית עזר ולוגיקה ייעודית במודול (`processCommands`). | 
| `recordWorldEvent(fxX, fxY, fxZ, label)` | 284 | פונקציית עזר ולוגיקה ייעודית במודול (`recordWorldEvent`). | 
| `_stepCorpseDecay()` | 302 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepCorpseDecay`). | 
| `stepTick(commands = [])` | 336 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepTick`). | 
| `computeStateHash()` | 364 | חישוב מתמטי/גאומטרי של נתוני המערכת (`computeStateHash`). | 
| `packSnapshot(measuredTpsPermille = 20000, reused...)` | 380 | פונקציית עזר ולוגיקה ייעודית במודול (`packSnapshot`). | 

### `src/sim/nav/astar.js`

**תפקיד הקובץ:** חיפוש מסלול A\* דו-כיווני מתחשב בבניינים, גשרים וקווי ראייה (`hasClearLineWorldFx`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(navGrid)` | 25 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `setBuildingsSource(fn)` | 46 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setBuildingsSource`). | 
| `_syncBuildingMask()` | 51 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncBuildingMask`). | 
| `_walk(tx, tz)` | 94 | פונקציית עזר ולוגיקה ייעודית במודול (`_walk`). | 
| `_walkWithClearance(tx, tz)` | 100 | פונקציית עזר ולוגיקה ייעודית במודול (`_walkWithClearance`). | 
| `_nearestFreeTile(tx, tz, maxRadius)` | 110 | פונקציית עזר ולוגיקה ייעודית במודול (`_nearestFreeTile`). | 
| `hasClearLineWorldFx(x0Fx, z0Fx, x1Fx, z1Fx)` | 126 | בדיקת תנאי בוליאני או תקינות מצב (`hasClearLineWorldFx`). | 
| `_hasClearLine(tx0, tz0, tx1, tz1)` | 136 | פונקציית עזר ולוגיקה ייעודית במודול (`_hasClearLine`). | 
| `_hasClearLineWithMargin(tx0, tz0, tx1, tz1)` | 176 | פונקציית עזר ולוגיקה ייעודית במודול (`_hasClearLineWithMargin`). | 
| `_octileHeuristic(tx, tz, goalTx, goalTz)` | 212 | פונקציית עזר ולוגיקה ייעודית במודול (`_octileHeuristic`). | 
| `_heapPush(nodeIdx)` | 220 | פונקציית עזר ולוגיקה ייעודית במודול (`_heapPush`). | 
| `_heapPop()` | 228 | פונקציית עזר ולוגיקה ייעודית במודול (`_heapPop`). | 
| `_heapBubbleUp(idx)` | 241 | פונקציית עזר ולוגיקה ייעודית במודול (`_heapBubbleUp`). | 
| `_heapSinkDown(idx)` | 259 | פונקציית עזר ולוגיקה ייעודית במודול (`_heapSinkDown`). | 
| `_centerTileInCorridor(tx, tz)` | 295 | פונקציית עזר ולוגיקה ייעודית במודול (`_centerTileInCorridor`). | 
| `_smoothTileChain(startTx, startTz, tileChain)` | 497 | פונקציית עזר ולוגיקה ייעודית במודול (`_smoothTileChain`). | 

### `src/sim/nav/flowField.js`

**תפקיד הקובץ:** חישוב שדות זרימה (`FlowFieldManager`) לתנועה קבוצתית יעילה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(params)` | 19 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `containsTile(tx, tz)` | 38 | פונקציית עזר ולוגיקה ייעודית במודול (`containsTile`). | 
| `sampleDirectionFx(fxX, fxZ)` | 44 | דגימה וחישוב ערך בנקודה או בזמן נתון (`sampleDirectionFx`). | 
| `clearCache()` | 77 | איפוס, ביטול או הסרה של נתונים ישנים (`clearCache`). | 
| `_makeKey(goalTx, goalTz, isCavalry)` | 81 | פונקציית עזר ולוגיקה ייעודית במודול (`_makeKey`). | 
| `getFlowFieldByKey(key, currentTick = 0)` | 171 | שליפת נתונים או מצב נוכחי (`getFlowFieldByKey`). | 
| `_evictOldest()` | 178 | פונקציית עזר ולוגיקה ייעודית במודול (`_evictOldest`). | 
| `_heapPush(localIdx, cost)` | 190 | פונקציית עזר ולוגיקה ייעודית במודול (`_heapPush`). | 
| `_heapPopNode()` | 210 | פונקציית עזר ולוגיקה ייעודית במודול (`_heapPopNode`). | 

### `src/sim/nav/grid.js`

**תפקיד הקובץ:** רשת הניווט (`NavGrid`), גבהי שטח, נהר, 3 גשרים, 4 מעברות רדודות ועלויות תנועה לפי סוג קרקע.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `getBridgeCentersMeters(worldCenterMeters = DEFAULT_CENTER_...)` | 59 | שליפת נתונים או מצב נוכחי (`getBridgeCentersMeters`). | 
| `getFordCentersMeters(worldCenterMeters = DEFAULT_CENTER_...)` | 65 | שליפת נתונים או מצב נוכחי (`getFordCentersMeters`). | 
| `minDistanceToBridgeXFx(fxX, worldCenterMeters = DEFAULT_CE...)` | 71 | פונקציית עזר ולוגיקה ייעודית במודול (`minDistanceToBridgeXFx`). | 
| `minDistanceToFordXFx(fxX, worldCenterMeters = DEFAULT_CE...)` | 83 | פונקציית עזר ולוגיקה ייעודית במודול (`minDistanceToFordXFx`). | 
| `computeRiverCenterZFx(fxX, worldCenterMeters = DEFAULT_CE...)` | 97 | חישוב מתמטי/גאומטרי של נתוני המערכת (`computeRiverCenterZFx`). | 
| `isOnBridgeFx(fxX, fxZ, bridgeCenterMeters = DEFA...)` | 108 | בדיקת תנאי בוליאני או תקינות מצב (`isOnBridgeFx`). | 
| `isOnWalkableBridgeDeckFx(fxX, fxZ, bridgeCenterMeters = DEFA...)` | 115 | בדיקת תנאי בוליאני או תקינות מצב (`isOnWalkableBridgeDeckFx`). | 
| `isOnBridgeSideWallFx(fxX, fxZ, bridgeCenterMeters = DEFA...)` | 122 | בדיקת תנאי בוליאני או תקינות מצב (`isOnBridgeSideWallFx`). | 
| `isInShallowFordZoneFx(fxX, worldCenterMeters = DEFAULT_CE...)` | 129 | בדיקת תנאי בוליאני או תקינות מצב (`isInShallowFordZoneFx`). | 
| `classifyTileTypeFx(fxX, fxZ, worldSizeMeters = DEFAULT...)` | 273 | פונקציית עזר ולוגיקה ייעודית במודול (`classifyTileTypeFx`). | 
| `_buildInitialGrid(config)` | 318 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildInitialGrid`). | 
| `isValidTile(tx, tz)` | 360 | בדיקת תנאי בוליאני או תקינות מצב (`isValidTile`). | 
| `getTileIndex(tx, tz)` | 366 | שליפת נתונים או מצב נוכחי (`getTileIndex`). | 
| `worldFxToTileX(fxX)` | 370 | פונקציית עזר ולוגיקה ייעודית במודול (`worldFxToTileX`). | 
| `worldFxToTileZ(fxZ)` | 375 | פונקציית עזר ולוגיקה ייעודית במודול (`worldFxToTileZ`). | 
| `tileToWorldCenterFxX(tx)` | 380 | פונקציית עזר ולוגיקה ייעודית במודול (`tileToWorldCenterFxX`). | 
| `tileToWorldCenterFxZ(tz)` | 384 | פונקציית עזר ולוגיקה ייעודית במודול (`tileToWorldCenterFxZ`). | 
| `getTileType(tx, tz)` | 388 | שליפת נתונים או מצב נוכחי (`getTileType`). | 
| `getTileTypeAtWorldFx(fxX, fxZ)` | 393 | שליפת נתונים או מצב נוכחי (`getTileTypeAtWorldFx`). | 
| `setTileType(tx, tz, tileType)` | 397 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setTileType`). | 
| `setRectTileType(minTx, minTz, maxTx, maxTz, tileType)` | 403 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setRectTileType`). | 
| `isWalkable(tx, tz)` | 416 | בדיקת תנאי בוליאני או תקינות מצב (`isWalkable`). | 
| `isWalkableTile(tx, tz)` | 421 | בדיקת תנאי בוליאני או תקינות מצב (`isWalkableTile`). | 
| `isWalkableWorldFx(fxX, fxZ)` | 425 | בדיקת תנאי בוליאני או תקינות מצב (`isWalkableWorldFx`). | 
| `getSpeedMultiplierPermille(tx, tz, isCavalry = false)` | 429 | שליפת נתונים או מצב נוכחי (`getSpeedMultiplierPermille`). | 
| `getSpeedMultiplierAtWorldFx(fxX, fxZ, isCavalry = false)` | 444 | שליפת נתונים או מצב נוכחי (`getSpeedMultiplierAtWorldFx`). | 
| `getTraversalCost(tx, tz, isCavalry = false)` | 452 | שליפת נתונים או מצב נוכחי (`getTraversalCost`). | 
| `sampleHeightAtWorldFx(fxX, fxZ)` | 467 | דגימה וחישוב ערך בנקודה או בזמן נתון (`sampleHeightAtWorldFx`). | 
| `findNearestWalkableTile(tx, tz, maxRadius = 24)` | 472 | איתור וסינון הישות או המיקום המתאים ביותר (`findNearestWalkableTile`). | 
| `hasClearLine(tx0, tz0, tx1, tz1)` | 493 | בדיקת תנאי בוליאני או תקינות מצב (`hasClearLine`). | 

### `src/sim/nav/spatialHash.js`

**תפקיד הקובץ:** מבנה נתונים מרחבי (`SpatialHash`) לחיפוש שכנים מהיר ב-`O(1)`.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(worldSizeMeters = 1024, cellSizeMet...)` | 18 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_ensureCapacity(requiredSlots)` | 38 | פונקציית עזר ולוגיקה ייעודית במודול (`_ensureCapacity`). | 
| `clear()` | 52 | איפוס, ביטול או הסרה של נתונים ישנים (`clear`). | 
| `worldFxToCellX(fxX)` | 60 | פונקציית עזר ולוגיקה ייעודית במודול (`worldFxToCellX`). | 
| `worldFxToCellZ(fxZ)` | 65 | פונקציית עזר ולוגיקה ייעודית במודול (`worldFxToCellZ`). | 
| `getCellIndex(cx, cz)` | 70 | שליפת נתונים או מצב נוכחי (`getCellIndex`). | 
| `rebuild(entitiesMap, sortedEntityIds)` | 82 | פונקציית עזר ולוגיקה ייעודית במודול (`rebuild`). | 
| `insert(entityId, xFx, zFx)` | 111 | פונקציית עזר ולוגיקה ייעודית במודול (`insert`). | 
| `queryRadiusIds(xFx, zFx, radiusFx, entitiesMap, ou...)` | 139 | פונקציית עזר ולוגיקה ייעודית במודול (`queryRadiusIds`). | 
| `scanRings(xFx, zFx, radiusFx, entitiesMap, sk...)` | 218 | פונקציית עזר ולוגיקה ייעודית במודול (`scanRings`). | 

### `src/sim/simBridge.js`

**תפקיד הקובץ:** הגשר בין ה-Main Thread ל-Web Worker (או מצב `?noworker`), כולל אינטרפולציית תנועה וזוויות ב-60 FPS.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_bindVisibilityRecovery()` | 50 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindVisibilityRecovery`). | 
| `_startLocalFallback()` | 60 | הפעלת תהליך או לולאת ריצה ב-`_startLocalFallback`. | 
| `start()` | 73 | הפעלת תהליך או לולאת ריצה ב-`start`. | 
| `setNoWorkerMode(useNoWorker)` | 103 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setNoWorkerMode`). | 
| `stop()` | 112 | עצירת פעילות ואיפוס מצב התנועה/הריצה ב-`stop`. | 
| `_handlePacket(packet)` | 126 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_handlePacket`). | 
| `getEconomyState()` | 226 | שליפת נתונים או מצב נוכחי (`getEconomyState`). | 
| `getFowGrid()` | 230 | שליפת נתונים או מצב נוכחי (`getFowGrid`). | 
| `getVictoryState()` | 234 | שליפת נתונים או מצב נוכחי (`getVictoryState`). | 
| `getInterpolatedBuildings()` | 238 | שליפת נתונים או מצב נוכחי (`getInterpolatedBuildings`). | 
| `getInterpolatedState(nowMs = performance.now())` | 242 | שליפת נתונים או מצב נוכחי (`getInterpolatedState`). | 

### `src/sim/simulationCore.js`

**תפקיד הקובץ:** לולאת ה-Tick המרכזית של הסימולציה (20 טיקים בשנייה, `50ms`), ניהול מאגרי הזיכרון (`ArrayBuffer`) והפקת חבילות `SNAPSHOT`.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(config, onSnapshotPacket)` | 6 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `receiveCommands(commands)` | 20 | פונקציית עזר ולוגיקה ייעודית במודול (`receiveCommands`). | 
| `recycleBuffers(metaBuffer, entityBuffer)` | 24 | פונקציית עזר ולוגיקה ייעודית במודול (`recycleBuffers`). | 
| `start()` | 29 | הפעלת תהליך או לולאת ריצה ב-`start`. | 
| `stop()` | 36 | עצירת פעילות ואיפוס מצב התנועה/הריצה ב-`stop`. | 
| `_step()` | 43 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_step`). | 

### `src/sim/worker.js`

**תפקיד הקובץ:** עטיפת ה-Web Worker המריצה את `SimulationCore` ברקע.

### `src/sim/world/worldGen.js`

**תפקיד הקובץ:** יצירה דטרמיניסטית של יערות (עצים) ומחצבים (זהב, ברזל, אבן) על המפה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `nextRandFx(spanFx)` | 66 | פונקציית עזר ולוגיקה ייעודית במודול (`nextRandFx`). | 
| `generateDeterministicMinesFx(worldSizeMeters = DEFAULT_WORLD_SIZ...)` | 187 | פונקציית עזר ולוגיקה ייעודית במודול (`generateDeterministicMinesFx`). | 

## 3. מערכות הסימולציה (`src/sim/systems/`)

### `src/sim/systems/ballisticAndDamageSystem.js`

**תפקיד הקובץ:** פיזיקת קליעים וחיצים, בליסטראות, נזק אזורי, הדף (`Knockback`) ונפילה (`Knockdown`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `applyDamageHurtReaction(target, targetComp, AnimState, isMi...)` | 66 | הגדרה והחלה של ערכים או פקודות על האובייקט (`applyDamageHurtReaction`). | 

### `src/sim/systems/buildingCombatSystem.js`

**תפקיד הקובץ:** ירי אוטומטי מצריחי מבנים, ריפוי ותגבורת במרפאה (`Infirmary`) והילות באף.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(constructionSystem)` | 34 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `setTowerManualTarget(buildingId, targetEntityId, team = 1)` | 38 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setTowerManualTarget`). | 
| `_resolveActiveManualSquadMembers(gameState, b, maxRangeFx)` | 45 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`_resolveActiveManualSquadMembers`). | 
| `_findClosestEnemyForTurret(gameState, b, rangeFx, maxLockRangeFx)` | 87 | איתור וסינון הישות או המיקום המתאים ביותר (`_findClosestEnemyForTurret`). | 
| `_pickDistributedTargetForGarrisonUnit(gameState, b, archerEnt, unitEffect...)` | 118 | איתור וסינון הישות או המיקום המתאים ביותר (`_pickDistributedTargetForGarrisonUnit`). | 
| `_stepGarrisonedArchers(gameState, b, AnimState, UnitTypeIndex)` | 206 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepGarrisonedArchers`). | 
| `_getSingleUnitReinforceCost(unitType)` | 283 | שליפת נתונים או מצב נוכחי (`_getSingleUnitReinforceCost`). | 
| `_stepInfirmaryAuraAndReinforcement(gameState, b, def, AnimState, UnitT...)` | 287 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepInfirmaryAuraAndReinforcement`). | 
| `_stepBannerHouseAura(gameState, b, def)` | 399 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepBannerHouseAura`). | 
| `_stepSupplyAmmoResupply(gameState, b)` | 423 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepSupplyAmmoResupply`). | 

### `src/sim/systems/combatSystem.js`

**תפקיד הקובץ:** ליבת הקרב — ניהול חריצי תקיפה סביב מטרה, בונוס איגוף (`FRONT/SIDE/BACK`), חסימות מגן והסתערות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(spatialHash, navGrid)` | 56 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `cleanupSlotReservations(entitiesMap)` | 66 | פונקציית עזר ולוגיקה ייעודית במודול (`cleanupSlotReservations`). | 
| `releaseAttackerSlot(attacker)` | 96 | פונקציית עזר ולוגיקה ייעודית במודול (`releaseAttackerSlot`). | 
| `getOccupiedSlotCount(targetId)` | 112 | שליפת נתונים או מצב נוכחי (`getOccupiedSlotCount`). | 
| `hasFreeMeleeSlot(targetId, attackerId)` | 122 | בדיקת תנאי בוליאני או תקינות מצב (`hasFreeMeleeSlot`). | 
| `reserveMeleeSlot(attacker, target, entitiesMap)` | 131 | פונקציית עזר ולוגיקה ייעודית במודול (`reserveMeleeSlot`). | 
| `hasTeammateBlockingForwardPath(attacker, goalXFx, goalZFx, entitie...)` | 200 | בדיקת תנאי בוליאני או תקינות מצב (`hasTeammateBlockingForwardPath`). | 
| `computeFlankWrapStepFx(attacker, goalXFx, goalZFx, comp, e...)` | 264 | חישוב מתמטי/גאומטרי של נתוני המערכת (`computeFlankWrapStepFx`). | 
| `hasFriendlyUnitsInFiringLine(shooter, targetXFx, targetZFx, dist...)` | 331 | בדיקת תנאי בוליאני או תקינות מצב (`hasFriendlyUnitsInFiringLine`). | 
| `classifyAttackArc(attackerXFx, attackerZFx, defender)` | 389 | פונקציית עזר ולוגיקה ייעודית במודול (`classifyAttackArc`). | 

### `src/sim/systems/constructionSystem.js`

**תפקיד הקובץ:** הצבת מבנים חדשים, בדיקת תקינות שטח ושיפוע, ניהול תור בנייה של פועלים ותיקון מבנים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_isBuildingActive(b)` | 48 | פונקציית עזר ולוגיקה ייעודית במודול (`_isBuildingActive`). | 
| `_getBuildingDoorVectorFx(building, distanceMeters)` | 54 | שליפת נתונים או מצב נוכחי (`_getBuildingDoorVectorFx`). | 
| `_spawnCitadelDefensiveSlots(team, cxFx, czFx)` | 64 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`_spawnCitadelDefensiveSlots`). | 
| `spawnStartingCitadels()` | 81 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnStartingCitadels`). | 
| `isPlacementValid(type, xFx, zFx, team = 1, checkReso...)` | 107 | בדיקת תנאי בוליאני או תקינות מצב (`isPlacementValid`). | 
| `_getLockedBuilderCompanyForBuilding(buildingId, companiesMap)` | 186 | שליפת נתונים או מצב נוכחי (`_getLockedBuilderCompanyForBuilding`). | 
| `_pickLeastBusyWorkerCompany(workerCompanyIds)` | 199 | איתור וסינון הישות או המיקום המתאים ביותר (`_pickLeastBusyWorkerCompany`). | 
| `_removeCitadelBastionSlots(citadelBuilding)` | 409 | איפוס, ביטול או הסרה של נתונים ישנים (`_removeCitadelBastionSlots`). | 
| `handleBuildingDestroyedInCombat(b, gameState)` | 441 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`handleBuildingDestroyedInCombat`). | 
| `demolishBuilding(buildingId, team = 1, gameState = null)` | 539 | פונקציית עזר ולוגיקה ייעודית במודול (`demolishBuilding`). | 
| `orderCompaniesToGarrison(companyIds, buildingId, team, gameS...)` | 589 | פונקציית עזר ולוגיקה ייעודית במודול (`orderCompaniesToGarrison`). | 
| `ungarrisonBuilding(buildingId, team, gameState, target...)` | 600 | פונקציית עזר ולוגיקה ייעודית במודול (`ungarrisonBuilding`). | 
| `setTowerManualTarget(buildingId, targetEntityId, team = 1)` | 604 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setTowerManualTarget`). | 
| `setBuildingRallyPoint(buildingId, rallyXFx, rallyZFx, tea...)` | 608 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setBuildingRallyPoint`). | 
| `getInstantUpgradeCostCoins(building)` | 618 | שליפת נתונים או מצב נוכחי (`getInstantUpgradeCostCoins`). | 
| `addBuildingXp(building, xpAmount)` | 622 | פונקציית עזר ולוגיקה ייעודית במודול (`addBuildingXp`). | 
| `instantUpgradeBuilding(buildingId, team = 1)` | 626 | פונקציית עזר ולוגיקה ייעודית במודול (`instantUpgradeBuilding`). | 
| `queueProductionOption(buildingId, optionId, team = 1)` | 630 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`queueProductionOption`). | 
| `cancelProductionOption(buildingId, optionId, team = 1)` | 634 | בדיקת תנאי בוליאני או תקינות מצב (`cancelProductionOption`). | 
| `_assignCircularPerimeterSlotsToBuilders(building, assignedComps, entitiesMap)` | 638 | פונקציית עזר ולוגיקה ייעודית במודול (`_assignCircularPerimeterSlotsToBuilders`). | 
| `_isCompanyStillExecutingPriorTask(comp, targetBldId, gameState)` | 688 | פונקציית עזר ולוגיקה ייעודית במודול (`_isCompanyStillExecutingPriorTask`). | 
| `_completeBuildingForAssignedBuilders(buildingId, assignedComps, gameState)` | 704 | פונקציית עזר ולוגיקה ייעודית במודול (`_completeBuildingForAssignedBuilders`). | 

### `src/sim/systems/economySystem.js`

**תפקיד הקובץ:** ניהול משאבי הצוותים, חישוב תקרת אוכלוסייה (`popCap`) ואוכלוסייה משוריינת (`reservedPop`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `resourceTypeToCarryCode(resType)` | 33 | פונקציית עזר ולוגיקה ייעודית במודול (`resourceTypeToCarryCode`). | 
| `_initDeterministicForest(config)` | 86 | אתחול והקמת הרכיבים עבור `_initDeterministicForest`. | 
| `_initDeterministicMines()` | 109 | אתחול והקמת הרכיבים עבור `_initDeterministicMines`. | 
| `isOverlappingResourceNode(xFx, zFx, footprintRadiusFx)` | 126 | בדיקת תנאי בוליאני או תקינות מצב (`isOverlappingResourceNode`). | 
| `computeTeamPopCap(teamId, buildingsMap = null, sorted...)` | 147 | חישוב מתמטי/גאומטרי של נתוני המערכת (`computeTeamPopCap`). | 
| `computeTeamPopUsedAndReserved(gameState, teamId)` | 164 | חישוב מתמטי/גאומטרי של נתוני המערכת (`computeTeamPopUsedAndReserved`). | 
| `getTeamLedger(team = 1)` | 198 | שליפת נתונים או מצב נוכחי (`getTeamLedger`). | 
| `grantCheatResources(team = 1, amount = 1000)` | 202 | פונקציית עזר ולוגיקה ייעודית במודול (`grantCheatResources`). | 
| `sanitizeCostForCategory(rawCost, category = 'building', uni...)` | 210 | פונקציית עזר ולוגיקה ייעודית במודול (`sanitizeCostForCategory`). | 
| `canAfford(team, rawCost, category = 'building...)` | 229 | בדיקת תנאי בוליאני או תקינות מצב (`canAfford`). | 
| `spendResources(team, rawCost, category = 'building...)` | 240 | פונקציית עזר ולוגיקה ייעודית במודול (`spendResources`). | 
| `refundResources(team, rawCost, category = 'building...)` | 251 | פונקציית עזר ולוגיקה ייעודית במודול (`refundResources`). | 
| `addResource(team, resourceType, amount)` | 260 | פונקציית עזר ולוגיקה ייעודית במודול (`addResource`). | 
| `findNearestGrownTree(xFx, zFx, maxRadiusFx = 64 * FX_ONE)` | 269 | איתור וסינון הישות או המיקום המתאים ביותר (`findNearestGrownTree`). | 
| `findNearestMine(xFx, zFx, maxRadiusFx = 24 * FX_ONE...)` | 285 | איתור וסינון הישות או המיקום המתאים ביותר (`findNearestMine`). | 
| `_findDropoffBuildingAtPoint(team, xFx, zFx, buildingsMap, sorte...)` | 302 | איתור וסינון הישות או המיקום המתאים ביותר (`_findDropoffBuildingAtPoint`). | 
| `_findNearestDropoffBuilding(team, xFx, zFx, buildingsMap, sorte...)` | 315 | איתור וסינון הישות או המיקום המתאים ביותר (`_findNearestDropoffBuilding`). | 
| `_setCompanyCarryProps(comp, carryCode, entitiesMap)` | 333 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setCompanyCarryProps`). | 
| `_assignCircularHarvestSlots(comp, nodeXFx, nodeZFx, isMine, ent...)` | 348 | פונקציית עזר ולוגיקה ייעודית במודול (`_assignCircularHarvestSlots`). | 
| `_funnelWorkersToDropoffWall(comp, dropoff, entitiesMap)` | 398 | פונקציית עזר ולוגיקה ייעודית במודול (`_funnelWorkersToDropoffWall`). | 

### `src/sim/systems/garrisonSystem.js`

**תפקיד הקובץ:** ניהול כניסת ויציאת פלוגות ממבנים ומגדלי שמירה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(constructionSystem)` | 15 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `ungarrisonBuilding(buildingId, team, gameState, target...)` | 97 | פונקציית עזר ולוגיקה ייעודית במודול (`ungarrisonBuilding`). | 
| `stepBuildingGarrisonExits(gameState, building, AnimState)` | 184 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepBuildingGarrisonExits`). | 
| `processPendingGarrisonOrders(gameState)` | 221 | פונקציית עזר ולוגיקה ייעודית במודול (`processPendingGarrisonOrders`). | 

### `src/sim/systems/heroMountedCombat.js`

**תפקיד הקובץ:** פיזיקת הסתערות ודריסה של גיבורים רכובים (`sisnat`, `ravan`) ותגובת נגד של חומת חניתות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `safeFaceTarget(ent, targetXFx, targetZFx)` | 21 | פונקציית עזר ולוגיקה ייעודית במודול (`safeFaceTarget`). | 
| `_checkAndApplySpearWallAntiCharge(gameState, comp, ent, foe)` | 45 | בדיקת תנאי בוליאני או תקינות מצב (`_checkAndApplySpearWallAntiCharge`). | 
| `_stepMountedHeroTrampleAndCycleCombat(gameState, comp, ent, AnimState)` | 118 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepMountedHeroTrampleAndCycleCombat`). | 
| `_setMountedCycleMoveTarget(gameState, comp, ent, targetXFx, ta...)` | 438 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setMountedCycleMoveTarget`). | 

### `src/sim/systems/heroRuntimeStepper.js`

**תפקיד הקובץ:** עדכון שוטף של גיבורים בכל טיק — קירור לחשים, הילות פעילות ותפוגת זימונים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `safeFaceTarget(ent, targetXFx, targetZFx)` | 21 | פונקציית עזר ולוגיקה ייעודית במודול (`safeFaceTarget`). | 
| `_despawnTemporaryCompany(gameState, companyId)` | 461 | פונקציית עזר ולוגיקה ייעודית במודול (`_despawnTemporaryCompany`). | 

### `src/sim/systems/heroSpellCaster.js`

**תפקיד הקובץ:** ביצוע הטלת לחשי גיבורים (`castHeroSpell`), באפים, הילות וזימון יחידות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `normalizeSpellId(spellId)` | 28 | פונקציית עזר ולוגיקה ייעודית במודול (`normalizeSpellId`). | 
| `safeFaceTarget(ent, targetXFx, targetZFx)` | 33 | פונקציית עזר ולוגיקה ייעודית במודול (`safeFaceTarget`). | 
| `_spawnReinforcementCompany(gameState, heroComp, heroEnt, unitT...)` | 99 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`_spawnReinforcementCompany`). | 
| `_resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, m...)` | 219 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`_resolveTargetUnitOrNearest`). | 
| `_resolveTargetBuilding(gameState, comp, targetOpts)` | 247 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`_resolveTargetBuilding`). | 
| `triggerRelease(gs)` | 288 | פונקציית עזר ולוגיקה ייעודית במודול (`triggerRelease`). | 

### `src/sim/systems/heroSpellDeliveries.js`

**תפקיד הקובץ:** ניהול קליעי לחשים מעופפים, מטחי מטאורים/חיצים וברק מדלג (`Chain Lightning`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `safeFaceTarget(ent, targetXFx, targetZFx)` | 25 | פונקציית עזר ולוגיקה ייעודית במודול (`safeFaceTarget`). | 
| `_stepActiveSpellDeliveries(gameState)` | 39 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepActiveSpellDeliveries`). | 

### `src/sim/systems/heroSystem.js`

**תפקיד הקובץ:** ניהול גיבורים, גיוס והחייאה לפי `trainTimeSec`, עלית רמות (1–10) והחלפת ערכות נשק.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `normalizeSpellId(spellId)` | 32 | פונקציית עזר ולוגיקה ייעודית במודול (`normalizeSpellId`). | 
| `lookupSpellInCatalog(heroesData, rawSpellId)` | 37 | פונקציית עזר ולוגיקה ייעודית במודול (`lookupSpellInCatalog`). | 
| `heroHasSecondaryLoadout(heroDef)` | 53 | פונקציית עזר ולוגיקה ייעודית במודול (`heroHasSecondaryLoadout`). | 
| `getEquipmentWeaponMode(equipment)` | 64 | שליפת נתונים או מצב נוכחי (`getEquipmentWeaponMode`). | 
| `getCumulativeXpForLevel(level, baseXp = 100)` | 86 | שליפת נתונים או מצב נוכחי (`getCumulativeXpForLevel`). | 
| `getNextCumulativeXpForLevel(level, baseXp = 100)` | 92 | שליפת נתונים או מצב נוכחי (`getNextCumulativeXpForLevel`). | 
| `safeFaceTarget(ent, targetXFx, targetZFx)` | 98 | פונקציית עזר ולוגיקה ייעודית במודול (`safeFaceTarget`). | 
| `syncHeroesConfig(newHeroesData, gameState = null)` | 127 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`syncHeroesConfig`). | 
| `getHeroDef(heroId)` | 190 | שליפת נתונים או מצב נוכחי (`getHeroDef`). | 
| `getHeroVisualOrder()` | 194 | שליפת נתונים או מצב נוכחי (`getHeroVisualOrder`). | 
| `getHeroVisualIndex(heroId)` | 198 | שליפת נתונים או מצב נוכחי (`getHeroVisualIndex`). | 
| `findSpellDef(rawSpellId)` | 204 | איתור וסינון הישות או המיקום המתאים ביותר (`findSpellDef`). | 
| `getHeroRecruitmentOption(heroId, team = 1)` | 211 | שליפת נתונים או מצב נוכחי (`getHeroRecruitmentOption`). | 
| `isHeroActiveOrQueued(gameState, team, heroId)` | 260 | בדיקת תנאי בוליאני או תקינות מצב (`isHeroActiveOrQueued`). | 
| `_resolveLoadoutWeaponMode(heroDef, loadoutIdx = 0)` | 284 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`_resolveLoadoutWeaponMode`). | 
| `_initHeroSpellsFromSchedule(comp)` | 298 | אתחול והקמת הרכיבים עבור `_initHeroSpellsFromSchedule`. | 
| `_syncHeroSpellsToWeaponMode(comp)` | 341 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncHeroSpellsToWeaponMode`). | 
| `switchHeroWeapon(gameState, companyId, team = 1)` | 394 | פונקציית עזר ולוגיקה ייעודית במודול (`switchHeroWeapon`). | 
| `spawnHeroFromBuilding(gameState, building, item, UnitType...)` | 452 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnHeroFromBuilding`). | 
| `advanceHeroToLevel(gameState, comp, ent, newLevel, emi...)` | 689 | פונקציית עזר ולוגיקה ייעודית במודול (`advanceHeroToLevel`). | 
| `_recomputeHeroPassiveAndLevelStats(comp, ent, healLevelBonus = false)` | 767 | פונקציית עזר ולוגיקה ייעודית במודול (`_recomputeHeroPassiveAndLevelStats`). | 
| `grantHeroXp(gameState, comp, ent, xpAmount)` | 885 | פונקציית עזר ולוגיקה ייעודית במודול (`grantHeroXp`). | 

### `src/sim/systems/moraleStaminaSystem.js`

**תפקיד הקובץ:** מערכת המורל, שבירת פלוגות, מנוסה (`ROUTING`) ותגובת שרשרת.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor()` | 27 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `applyMoraleShock(comp, rawDropPermille, _reason = '')` | 29 | הגדרה והחלה של ערכים או פקודות על האובייקט (`applyMoraleShock`). | 
| `onMeleeSwing(_comp)` | 66 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMeleeSwing`). | 
| `getExhaustionSpeedMultiplierPermille(comp)` | 70 | שליפת נתונים או מצב נוכחי (`getExhaustionSpeedMultiplierPermille`). | 
| `_findTeamCitadelCoordsFx(gameState, team)` | 77 | איתור וסינון הישות או המיקום המתאים ביותר (`_findTeamCitadelCoordsFx`). | 
| `triggerCompanyBreak(gameState, comp, isCascade = false)` | 94 | פונקציית עזר ולוגיקה ייעודית במודול (`triggerCompanyBreak`). | 
| `update(gameState)` | 134 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/sim/systems/movementSystem.js`

**תפקיד הקובץ:** מערכת התנועה הפלוגתית — הזזת עוגן הפלוגה (`anchorXFx/ZFx`), סנכרון קבוצות `Alt`, ניהול סטמינה, עקיפת פלוגות ואיפוס ריצה בעצירה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `getPhysicsProfile(unitTypeIdx)` | 200 | שליפת נתונים או מצב נוכחי (`getPhysicsProfile`). | 
| `assignUnitAStarRoute(ent, targetXFx, targetZFx, comp = n...)` | 381 | הגדרה והחלה של ערכים או פקודות על האובייקט (`assignUnitAStarRoute`). | 
| `_stepCompanyStamina(comp, prof, entitiesMap)` | 438 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepCompanyStamina`). | 
| `_computeCompanyRawStepSpeedFx(comp)` | 483 | חישוב מתמטי/גאומטרי של נתוני המערכת (`_computeCompanyRawStepSpeedFx`). | 
| `_synchronizeAltGroups(companies, companyIds)` | 509 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_synchronizeAltGroups`). | 
| `_updateCompanies(gameState)` | 565 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateCompanies`). | 
| `ringedWp(w)` | 775 | פונקציית עזר ולוגיקה ייעודית במודול (`ringedWp`). | 

### `src/sim/systems/productionAndRallySystem.js`

**תפקיד הקובץ:** תור ייצור יחידות וגיבורים בבניינים, המתנה דטרמיניסטית ב-99% (`HOLD (Full Pop)`), עלית רמות לבניינים ונקודות Rally.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(constructionSystem)` | 25 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `setBuildingRallyPoint(buildingId, rallyXFx, rallyZFx, tea...)` | 30 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setBuildingRallyPoint`). | 
| `getInstantUpgradeCostCoins(building)` | 139 | שליפת נתונים או מצב נוכחי (`getInstantUpgradeCostCoins`). | 
| `addBuildingXp(building, xpAmount)` | 150 | פונקציית עזר ולוגיקה ייעודית במודול (`addBuildingXp`). | 
| `levelUpBuilding(building, def)` | 162 | פונקציית עזר ולוגיקה ייעודית במודול (`levelUpBuilding`). | 
| `instantUpgradeBuilding(buildingId, team = 1)` | 182 | פונקציית עזר ולוגיקה ייעודית במודול (`instantUpgradeBuilding`). | 
| `queueProductionOption(buildingId, optionId, team = 1)` | 214 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`queueProductionOption`). | 
| `cancelProductionOption(buildingId, optionId, team = 1)` | 300 | בדיקת תנאי בוליאני או תקינות מצב (`cancelProductionOption`). | 
| `_findFreeMusterSpotNear(gameState, baseXFx, baseZFx, facing...)` | 330 | איתור וסינון הישות או המיקום המתאים ביותר (`_findFreeMusterSpotNear`). | 
| `isSpotBlocked(xFx, zFx)` | 377 | בדיקת תנאי בוליאני או תקינות מצב (`isSpotBlocked`). | 
| `_pushBackBlockingCompanies(gameState, building, musterXFx, mus...)` | 421 | פונקציית עזר ולוגיקה ייעודית במודול (`_pushBackBlockingCompanies`). | 
| `spawnSingleReinforcedUnitFromBuilding(gameState, building, comp, UnitType...)` | 500 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnSingleReinforcedUnitFromBuilding`). | 
| `startSequentialCompanySpawn(gameState, building, item, UnitType...)` | 583 | הפעלת תהליך או לולאת ריצה ב-`startSequentialCompanySpawn`. | 
| `executeSmartRallyActionForCompany(gameState, building, comp)` | 654 | פונקציית עזר ולוגיקה ייעודית במודול (`executeSmartRallyActionForCompany`). | 
| `stepBuildingDoorSpawns(gameState, building, AnimState)` | 802 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepBuildingDoorSpawns`). | 
| `getItemPopulationCost(item)` | 917 | שליפת נתונים או מצב נוכחי (`getItemPopulationCost`). | 
| `hasPopulationRoomFor(gameState, team, neededPop)` | 926 | בדיקת תנאי בוליאני או תקינות מצב (`hasPopulationRoomFor`). | 
| `stepBuildingProduction(gameState, building, UnitTypeIndex)` | 935 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepBuildingProduction`). | 
| `flushPendingLevelUpEvents(gameState)` | 993 | פונקציית עזר ולוגיקה ייעודית במודול (`flushPendingLevelUpEvents`). | 

### `src/sim/systems/unitCollisionSystem.js`

**תפקיד הקובץ:** מערכת התנגשויות, הפרדת Boids, מניעת כניסה לבניינים ודחיפות מסה (כולל מעבר חלק בין חיילי אותה פלוגה ללא החלקה).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(spatialHash, navGrid, getPhysicsPro...)` | 26 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_isFrontlineFighter(ent, comp)` | 38 | פונקציית עזר ולוגיקה ייעודית במודול (`_isFrontlineFighter`). | 
| `_isCombatAnchored(ent, comp)` | 49 | פונקציית עזר ולוגיקה ייעודית במודול (`_isCombatAnchored`). | 
| `clampPointOutsideBuildingsFx(xFx, zFx, clearanceMarginFx, buildi...)` | 152 | פונקציית עזר ולוגיקה ייעודית במודול (`clampPointOutsideBuildingsFx`). | 
| `computeBoidsSeparationFx(ent, prof, entitiesMap)` | 183 | חישוב מתמטי/גאומטרי של נתוני המערכת (`computeBoidsSeparationFx`). | 
| `_computeOpenSpaceEscapeImpulseFx(ent, entitiesMap, worldMinFx, world...)` | 268 | חישוב מתמטי/גאומטרי של נתוני המערכת (`_computeOpenSpaceEscapeImpulseFx`). | 

### `src/sim/systems/unitCombatStepper.js`

**תפקיד הקובץ:** צעד הלחימה הפרטני של כל חייל (קפא"פ וירי מרחוק).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_stepRangedShot(ent, comp, prof, gameState, reloadM...)` | 41 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepRangedShot`). | 
| `_computeOrderlyStandbyPositionFx(ent, comp, nearEnemy)` | 69 | חישוב מתמטי/גאומטרי של נתוני המערכת (`_computeOrderlyStandbyPositionFx`). | 

### `src/sim/systems/unitCombatSystem.js`

**תפקיד הקובץ:** זיהוי ורכישת מטרות ברמת הפלוגה ובידוד קרב מול שערים ומעברים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(spatialHash, navGrid)` | 36 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `beginTick(gameState, enums)` | 43 | פונקציית עזר ולוגיקה ייעודית במודול (`beginTick`). | 
| `accepts(cand)` | 79 | פונקציית עזר ולוגיקה ייעודית במודול (`accepts`). | 
| `findNearestEnemyBuilding(xFx, zFx, scanRadiusFx, myTeam, gam...)` | 208 | איתור וסינון הישות או המיקום המתאים ביותר (`findNearestEnemyBuilding`). | 
| `_evaluatePhysicalInterceptionBreak(comp, entitiesMap)` | 252 | דגימה וחישוב ערך בנקודה או בזמן נתון (`_evaluatePhysicalInterceptionBreak`). | 
| `evaluateCompanyCombatEngagement(comp, prof, entitiesMap, gameState ...)` | 315 | דגימה וחישוב ערך בנקודה או בזמן נתון (`evaluateCompanyCombatEngagement`). | 

### `src/sim/systems/unitLocomotionStepper.js`

**תפקיד הקובץ:** צעד התנועה הפרטני לכל חייל — היגוי למשבצת, עקיפת מכשולים, פינוי דרך בין פלוגות וקביעת מצב אנימציה (`WALK / RUN / CHARGE / IDLE`).

### `src/sim/systems/victorySystem.js`

**תפקיד הקובץ:** בדיקת תנאי ניצחון והפסד, מצב `LAST STAND` וקריסת מבנים בסיום.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor()` | 26 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `isProductionBuilding(b)` | 66 | בדיקת תנאי בוליאני או תקינות מצב (`isProductionBuilding`). | 
| `_recountTeamAssets(gameState, UnitTypeIndex)` | 71 | פונקציית עזר ולוגיקה ייעודית במודול (`_recountTeamAssets`). | 
| `_canTeamAffordAnyBuilding(gameState, team)` | 121 | פונקציית עזר ולוגיקה ייעודית במודול (`_canTeamAffordAnyBuilding`). | 
| `startCollapseForTeam(gameState, losingTeam)` | 133 | הפעלת תהליך או לולאת ריצה ב-`startCollapseForTeam`. | 
| `_stepCollapseSequence(gameState)` | 174 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepCollapseSequence`). | 
| `getSnapshotState()` | 297 | שליפת נתונים או מצב נוכחי (`getSnapshotState`). | 

### `src/sim/systems/visionSystem.js`

**תפקיד הקובץ:** חישוב ערפל מלחמה תלת-שלבי (`UNEXPLORED / EXPLORED / VISIBLE`) עם חסימת קו ראייה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_buildStaticTerrainCaches()` | 71 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildStaticTerrainCaches`). | 
| `_rebuildBlockerGrid(gameState)` | 124 | פונקציית עזר ולוגיקה ייעודית במודול (`_rebuildBlockerGrid`). | 
| `worldFxToCellX(fxX)` | 164 | פונקציית עזר ולוגיקה ייעודית במודול (`worldFxToCellX`). | 
| `worldFxToCellZ(fxZ)` | 168 | פונקציית עזר ולוגיקה ייעודית במודול (`worldFxToCellZ`). | 
| `_revealObserverWithLos(wxMeters, wzMeters, observerYMeters...)` | 177 | פונקציית עזר ולוגיקה ייעודית במודול (`_revealObserverWithLos`). | 
| `addTemporaryReveal(xFx, zFx, radiusMeters, durationTic...)` | 269 | פונקציית עזר ולוגיקה ייעודית במודול (`addTemporaryReveal`). | 
| `_revealCircleUnblocked(cx, cz, radiusCells, isSpellReveal ...)` | 287 | פונקציית עזר ולוגיקה ייעודית במודול (`_revealCircleUnblocked`). | 
| `update(gameState, forceImmediate = false)` | 316 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/sim/systems/workerGatheringStepper.js`

**תפקיד הקובץ:** מכונת המצבים של הפועלים — הליכה לעץ/מכרה, חציבה/כריתה, חזרה למבנה אגירה והפקדת משאבים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `resourceTypeToCarryCode(resType)` | 37 | פונקציית עזר ולוגיקה ייעודית במודול (`resourceTypeToCarryCode`). | 
| `_activateGatherTaskForCompany(comp, gatherSpec, gameState)` | 59 | פונקציית עזר ולוגיקה ייעודית במודול (`_activateGatherTaskForCompany`). | 
| `cancelGatheringForCompanies(companyIds, entitiesMap = null, com...)` | 262 | בדיקת תנאי בוליאני או תקינות מצב (`cancelGatheringForCompanies`). | 
| `_autoResumeGatheringAfterDropoff(comp, deliveredType, dropoffBld, ga...)` | 357 | פונקציית עזר ולוגיקה ייעודית במודול (`_autoResumeGatheringAfterDropoff`). | 
| `_stepExplicitDropoffOrder(comp, buildingsMap, currentTick, ga...)` | 408 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepExplicitDropoffOrder`). | 
| `getDepletedTreeIds()` | 481 | שליפת נתונים או מצב נוכחי (`getDepletedTreeIds`). | 
| `update(currentTick, buildingsMap, sortedBu...)` | 492 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

## 4. מוח ה-AI החכם (`src/sim/ai/`)

### `src/sim/ai/aiEconomyPlanner.js`

**תפקיד הקובץ:** מתכנן הכלכלה, הבנייה וגיוס הקאונטר של ה-AI — הקצאת פועלים לעצים/מכרות, בניית בתים ומבני צבא בסדר מאוזן וגיוס מותאם.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(team = 2, perception = null)` | 21 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `findHomeBaseBuilding(gameState)` | 30 | איתור וסינון הישות או המיקום המתאים ביותר (`findHomeBaseBuilding`). | 
| `_isWorkerBusyBuilding(cs, wComp)` | 45 | פונקציית עזר ולוגיקה ייעודית במודול (`_isWorkerBusyBuilding`). | 
| `stepWorkerGathering(gameState, outCommands)` | 69 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepWorkerGathering`). | 
| `findValidBuildingSpotFx(gameState, buildingType, centerXFx,...)` | 163 | איתור וסינון הישות או המיקום המתאים ביותר (`findValidBuildingSpotFx`). | 
| `_cancelPendingGatherCommandForWorker(outCommands, workerCompanyId)` | 194 | פונקציית עזר ולוגיקה ייעודית במודול (`_cancelPendingGatherCommandForWorker`). | 
| `stepBaseConstruction(gameState, doctrine, adaptiveWeight...)` | 210 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepBaseConstruction`). | 
| `stepUnitAndHeroProduction(gameState, doctrine, adaptiveWeight...)` | 354 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepUnitAndHeroProduction`). | 

### `src/sim/ai/aiPerception.js`

**תפקיד הקובץ:** מערכת התפיסה וערפל המלחמה העצמאי של ה-AI (`fowGrid`), ניתוח טופוגרפי של גשרים/מעברות/גבעות וזיכרון מבני אויב.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(team = 2)` | 29 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `worldFxToCellX(fxX, worldSizeFx)` | 56 | פונקציית עזר ולוגיקה ייעודית במודול (`worldFxToCellX`). | 
| `worldFxToCellZ(fxZ, worldSizeFx)` | 61 | פונקציית עזר ולוגיקה ייעודית במודול (`worldFxToCellZ`). | 
| `getCellStateAtWorldFx(fxX, fxZ, worldSizeFx)` | 66 | שליפת נתונים או מצב נוכחי (`getCellStateAtWorldFx`). | 
| `isWorldPointVisible(fxX, fxZ, worldSizeFx)` | 72 | בדיקת תנאי בוליאני או תקינות מצב (`isWorldPointVisible`). | 
| `isWorldPointExplored(fxX, fxZ, worldSizeFx)` | 76 | בדיקת תנאי בוליאני או תקינות מצב (`isWorldPointExplored`). | 
| `analyzeTerrainTopography(gameState)` | 83 | פונקציית עזר ולוגיקה ייעודית במודול (`analyzeTerrainTopography`). | 
| `updatePerception(gameState)` | 144 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`updatePerception`). | 
| `revealCircle(wxMeters, wzMeters, radiusMeters)` | 160 | פונקציית עזר ולוגיקה ייעודית במודול (`revealCircle`). | 
| `pickNextScoutingTargetFx(gameState, scoutAnchorXFx, scoutAnc...)` | 329 | איתור וסינון הישות או המיקום המתאים ביותר (`pickNextScoutingTargetFx`). | 

### `src/sim/ai/aiTacticalCommander.js`

**תפקיד הקובץ:** המפקד הטקטי של ה-AI — שליחת סיירים, החלפת מבנים וריצה/הליכה, הטלת לחשי גיבור, הגנת בסיס והתקפות מתואמות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(team = 2, perception = null)` | 19 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_canIssueMoveOrderToCompany(comp, targetXFx, targetZFx, orderTy...)` | 30 | פונקציית עזר ולוגיקה ייעודית במודול (`_canIssueMoveOrderToCompany`). | 
| `getCombatCompanies(gameState)` | 56 | שליפת נתונים או מצב נוכחי (`getCombatCompanies`). | 
| `stepScouting(gameState, combatCompanies, visible...)` | 78 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepScouting`). | 
| `stepFormationAndGaitMicro(gameState, combatCompanies, visible...)` | 158 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepFormationAndGaitMicro`). | 
| `stepHeroMicro(gameState, combatCompanies, visible...)` | 245 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepHeroMicro`). | 

### `src/sim/ai/enemyAiController.js`

**תפקיד הקובץ:** המוח הראשי של ה-AI (`EnemyAiController`) — בחירת דוקטרינה אקראית, למידת הרכב צבא השחקן והפקת פקודות חוקיות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `setMode(modeString)` | 56 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setMode`). | 
| `_ensureDoctrineSelected(gameState)` | 68 | פונקציית עזר ולוגיקה ייעודית במודול (`_ensureDoctrineSelected`). | 
| `_updateAdaptiveCounterWeights(gameState, observed)` | 88 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateAdaptiveCounterWeights`). | 
| `generateCommands(gameState)` | 145 | פונקציית עזר ולוגיקה ייעודית במודול (`generateCommands`). | 

## 5. שכבת הרינדור והאנימציה התלת-ממדית (`src/render/`)

### `src/render/animator3d.js`

**תפקיד הקובץ:** מנוע האנימציה התלת-ממדי (`Animator3D`) — שילוב שכבת רגליים (`lowerBody`), פלג גוף עליון (`upperBody`) וגוף מלא (`fullBody`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_rebuildFastJointCache()` | 68 | פונקציית עזר ולוגיקה ייעודית במודול (`_rebuildFastJointCache`). | 
| `onEvent(callback)` | 126 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onEvent`). | 
| `setLocomotion(clipNameOrVariants, speedMultiplier...)` | 131 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setLocomotion`). | 
| `getActionHitFraction(clipName)` | 209 | שליפת נתונים או מצב נוכחי (`getActionHitFraction`). | 
| `getActionHoldFraction(clipName)` | 227 | שליפת נתונים או מצב נוכחי (`getActionHoldFraction`). | 
| `getActionTailSeconds(clipName)` | 235 | שליפת נתונים או מצב נוכחי (`getActionTailSeconds`). | 
| `releaseHold(secondsToHit)` | 260 | פונקציית עזר ולוגיקה ייעודית במודול (`releaseHold`). | 
| `cancelAction()` | 270 | בדיקת תנאי בוליאני או תקינות מצב (`cancelAction`). | 
| `resetFullBody()` | 285 | איפוס, ביטול או הסרה של נתונים ישנים (`resetFullBody`). | 
| `_checkAndFireEvents(eventsList, prevNorm, currNorm, cli...)` | 295 | בדיקת תנאי בוליאני או תקינות מצב (`_checkAndFireEvents`). | 
| `_commitFastJoints(fastJoints)` | 329 | פונקציית עזר ולוגיקה ייעודית במודול (`_commitFastJoints`). | 
| `update(rawDtSeconds)` | 352 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 
| `_applyKeyframeClip(clip, normT, weight, fastJointMap, ...)` | 884 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applyKeyframeClip`). | 

### `src/render/assetAdapter.js`

**תפקיד הקובץ:** יצירת גאומטריות בסיסיות, טקסטורות פרוצדורליות וחיבורי Sockets למודלים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor()` | 31 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `registerGltfLoader(loaderFn)` | 39 | פונקציית עזר ולוגיקה ייעודית במודול (`registerGltfLoader`). | 
| `resolveColor(colorToken, teamPalette)` | 43 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveColor`). | 
| `getRingGeometry(ringRadius)` | 52 | שליפת נתונים או מצב נוכחי (`getRingGeometry`). | 
| `getSharedStandardMaterial(resolvedHex, roughness, metalness, ...)` | 62 | שליפת נתונים או מצב נוכחי (`getSharedStandardMaterial`). | 
| `getPrimitiveGeometry(partDef)` | 79 | שליפת נתונים או מצב נוכחי (`getPrimitiveGeometry`). | 
| `getPatternTexture(name, repeat)` | 176 | שליפת נתונים או מצב נוכחי (`getPatternTexture`). | 
| `createPrimitiveMesh(partDef, teamPalette, materialRegis...)` | 287 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`createPrimitiveMesh`). | 
| `bindGltfSockets(gltfRootGroup, socketsMap, restPose...)` | 337 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`bindGltfSockets`). | 

### `src/render/buildingArchitectures.js`

**תפקיד הקובץ:** בניית הגאומטריה האדריכלית המפורטת של כל סוגי הבניינים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `addCourtyardGateFence(bodyGroup, type, r, mats, doorSign)` | 32 | פונקציית עזר ולוגיקה ייעודית במודול (`addCourtyardGateFence`). | 
| `addBuildingDoorway(bodyGroup, r, mats, doorSign, type)` | 122 | פונקציית עזר ולוגיקה ייעודית במודול (`addBuildingDoorway`). | 
| `populateArchitectureByType(type, r, mats, body, doorSign)` | 164 | פונקציית עזר ולוגיקה ייעודית במודול (`populateArchitectureByType`). | 

### `src/render/buildingModelFactory.js`

**תפקיד הקובץ:** מפעל מודלי הבניינים, פיגומי בנייה, דגלים וטבעות בחירה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `mergeStaticGroupMeshesByMaterial(group, { castShadow = true, receive...)` | 30 | פונקציית עזר ולוגיקה ייעודית במודול (`mergeStaticGroupMeshesByMaterial`). | 
| `constructor()` | 144 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_createActorMaterials(team = 1, isGhost = false)` | 148 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_createActorMaterials`). | 
| `setBuildingSelectHighlight(actor, intensity = 0)` | 290 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setBuildingSelectHighlight`). | 
| `createMineOutcropMesh(mine)` | 483 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`createMineOutcropMesh`). | 
| `createRallyFlagMesh()` | 524 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`createRallyFlagMesh`). | 

### `src/render/cameraController.js`

**תפקיד הקובץ:** שליטה במצלמת ה-RTS — הזזה (WASD/קצוות מסך), זום, סיבוב והתמקדות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(camera, domElement, config, eventBu...)` | 13 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_bindWorldEvents()` | 71 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindWorldEvents`). | 
| `resetViewOrientationAndZoom()` | 92 | איפוס, ביטול או הסרה של נתונים ישנים (`resetViewOrientationAndZoom`). | 
| `onMouseEnter()` | 102 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseEnter`). | 
| `onMouseLeave()` | 106 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseLeave`). | 
| `onKeyDown(e)` | 111 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onKeyDown`). | 
| `onKeyUp(e)` | 121 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onKeyUp`). | 
| `onMouseDown(e)` | 125 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseDown`). | 
| `onMouseMove(e)` | 160 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseMove`). | 
| `onMouseUp()` | 184 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseUp`). | 
| `onWheel(e)` | 192 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onWheel`). | 
| `setEdgePanEnabled(enabled)` | 204 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setEdgePanEnabled`). | 
| `_panByLocalOffsets(rightDelta, forwardDelta)` | 208 | פונקציית עזר ולוגיקה ייעודית במודול (`_panByLocalOffsets`). | 
| `focusOnLastEvent()` | 233 | פונקציית עזר ולוגיקה ייעודית במודול (`focusOnLastEvent`). | 
| `update(dtSeconds)` | 245 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 
| `_applyCameraTransform(alpha)` | 274 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applyCameraTransform`). | 

### `src/render/heroSpellAnimations.js`

**תפקיד הקובץ:** פרופילי תזמון אנימציות הטלת לחשים של גיבורים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `getSpellCastTimingProfile(spellId, weaponMode = 'melee', dist...)` | 197 | שליפת נתונים או מצב נוכחי (`getSpellCastTimingProfile`). | 

### `src/render/keyframeSampler.js`

**תפקיד הקובץ:** דגימת מסילות Keyframe (`sampleKeyframeTrackInto`) ואינטרפולציית ערוצי סיבוב ומיקום.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `smoothstep01(t)` | 33 | פונקציית עזר ולוגיקה ייעודית במודול (`smoothstep01`). | 
| `easeInOutQuad(t)` | 38 | פונקציית עזר ולוגיקה ייעודית במודול (`easeInOutQuad`). | 
| `ensureTrackMetadata(keyframes)` | 53 | פונקציית עזר ולוגיקה ייעודית במודול (`ensureTrackMetadata`). | 
| `isTrackEffectivelyAnimated(keyframes)` | 96 | בדיקת תנאי בוליאני או תקינות מצב (`isTrackEffectivelyAnimated`). | 
| `sampleChannelInto(keyframes, normT, prop, keyFlag, ou...)` | 102 | דגימה וחישוב ערך בנקודה או בזמן נתון (`sampleChannelInto`). | 
| `sampleKeyframeTrackInto(keyframes, normT, out)` | 194 | דגימה וחישוב ערך בנקודה או בזמן נתון (`sampleKeyframeTrackInto`). | 

### `src/render/modelFactory.js`

**תפקיד הקובץ:** בניית המודלים התלת-ממדיים של כל היחידות, הציוד, הרמחים, הסוסים ומתיחת מיתר הקשת (`updateBowstringRig`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(visualsJson)` | 12 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_ensureSharedCarryResources()` | 18 | פונקציית עזר ולוגיקה ייעודית במודול (`_ensureSharedCarryResources`). | 
| `getTeamPalette(teamId = 1)` | 70 | שליפת נתונים או מצב נוכחי (`getTeamPalette`). | 
| `getFactions()` | 81 | שליפת נתונים או מצב נוכחי (`getFactions`). | 
| `getFactionTeamColors(factionId)` | 94 | שליפת נתונים או מצב נוכחי (`getFactionTeamColors`). | 
| `getUnitsForFaction(factionId)` | 99 | שליפת נתונים או מצב נוכחי (`getUnitsForFaction`). | 
| `createPrefab(prefabId, teamPalette, materialRegi...)` | 110 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`createPrefab`). | 
| `addInkPart(partDef)` | 248 | פונקציית עזר ולוגיקה ייעודית במודול (`addInkPart`). | 
| `_createWorkerCarryProps(torsoGroup)` | 405 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_createWorkerCarryProps`). | 
| `freezeStaticMesh(m)` | 415 | פונקציית עזר ולוגיקה ייעודית במודול (`freezeStaticMesh`). | 
| `setWorkerCarryProp(unitGroup, carryType = 0)` | 493 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setWorkerCarryProp`). | 
| `calibrateWeaponGrip(unitGroup, socketName, gripOffset, ...)` | 976 | פונקציית עזר ולוגיקה ייעודית במודול (`calibrateWeaponGrip`). | 
| `updateBowstringRig(unitGroup)` | 996 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`updateBowstringRig`). | 

### `src/render/orderLineRenderer.js`

**תפקיד הקובץ:** ציור חצי פקודות תנועה, קווי תור פקודות מרוסקים ודגלי Rally.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(scene)` | 24 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `sampleExactGroundY(xMeters, zMeters)` | 38 | דגימה וחישוב ערך בנקודה או בזמן נתון (`sampleExactGroundY`). | 
| `buildTerrainConformingSegmentPoints(x0, z0, x1, z1, yOffset = 0.35)` | 47 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildTerrainConformingSegmentPoints`). | 
| `spawnEphemeralClickMarker(worldPoint, orderType = 'MOVE', rad...)` | 61 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnEphemeralClickMarker`). | 
| `updateEphemeralMarkers(dtSeconds)` | 109 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`updateEphemeralMarkers`). | 
| `clearLines()` | 126 | איפוס, ביטול או הסרה של נתונים ישנים (`clearLines`). | 
| `renderSegments(segments)` | 140 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`renderSegments`. | 

### `src/render/sceneManager.js`

**תפקיד הקובץ:** מנהל הסצנה הראשי ב-Three.js — תאורה, צללים, לולאת הרינדור ב-60 FPS וניקוי מלא (`destroy`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_facingDirToThreeYaw(facingDir)` | 248 | פונקציית עזר ולוגיקה ייעודית במודול (`_facingDirToThreeYaw`). | 
| `_sampleGroundHeightFast(x, z)` | 252 | פונקציית עזר ולוגיקה ייעודית במודול (`_sampleGroundHeightFast`). | 
| `flashBuilding(buildingId, mode = 'command')` | 256 | פונקציית עזר ולוגיקה ייעודית במודול (`flashBuilding`). | 
| `_setupLighting()` | 269 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setupLighting`). | 
| `_handleAnimatorEvent(evt)` | 300 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_handleAnimatorEvent`). | 
| `_getOrCreateRallyFlagAt(index)` | 305 | שליפת נתונים או מצב נוכחי (`_getOrCreateRallyFlagAt`). | 
| `_getOrCreateRallyLineAt(index)` | 318 | שליפת נתונים או מצב נוכחי (`_getOrCreateRallyLineAt`). | 
| `_updateMultiBuildingRallyVisuals(selectedBlds)` | 344 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateMultiBuildingRallyVisuals`). | 
| `_syncDepletedTreesAndMines()` | 427 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncDepletedTreesAndMines`). | 
| `_updateBuildingsRender(dtSeconds)` | 450 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateBuildingsRender`). | 
| `_syncViewportSize()` | 589 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncViewportSize`). | 
| `_bindInteractions()` | 599 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindInteractions`). | 
| `start()` | 620 | הפעלת תהליך או לולאת ריצה ב-`start`. | 
| `loop()` | 623 | פונקציית עזר ולוגיקה ייעודית במודול (`loop`). | 
| `destroy()` | 631 | ניקוי משאבים, מאזינים וזיכרון עבור `destroy`. | 
| `_renderFrame(now)` | 647 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderFrame`. | 

### `src/render/spellEffects.js`

**תפקיד הקובץ:** מנהל האפקטים הוויזואליים של לחשי הגיבורים בזמן אמת (`SpellEffectsRenderer`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `addImpactRing(pos, colorHex, maxR = 3.5, maxAge =...)` | 45 | פונקציית עזר ולוגיקה ייעודית במודול (`addImpactRing`). | 

### `src/render/spellGeometryBuilders.js`

**תפקיד הקובץ:** בניית גאומטריות ואפקטים תלת-ממדיים ללחשים (כדורי אש, ברקים, נחשים, גלי הדף ולהבות).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `getVolleySculptedArrowMesh(isPreview = false)` | 34 | שליפת נתונים או מצב נוכחי (`getVolleySculptedArrowMesh`). | 
| `buildTerrainConformingRing(radiusInner, radiusOuter, centerX, ...)` | 105 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildTerrainConformingRing`). | 
| `inferDefaultVfxStyle(spellId, explicitStyle = null)` | 163 | פונקציית עזר ולוגיקה ייעודית במודול (`inferDefaultVfxStyle`). | 
| `buildDynamicShortSerpent({ bodyHex = 0x10b981, bellyHex = 0x...)` | 305 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildDynamicShortSerpent`). | 
| `buildCurvedSwordSlashMesh({ colorHex = 0xef4444, coreHex = 0x...)` | 395 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildCurvedSwordSlashMesh`). | 
| `spawnJaggedLightningBolt({ fxGroup, activeFxPulses, fromPos,...)` | 435 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnJaggedLightningBolt`). | 
| `createStrand(radius, hex, jitterAmp)` | 439 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`createStrand`). | 
| `createBurningUnitFlameCluster()` | 499 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`createBurningUnitFlameCluster`). | 
| `updateBurningUnitFlameCluster(cluster, wx, wy, wz, dtSeconds)` | 530 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`updateBurningUnitFlameCluster`). | 

### `src/render/terrainRenderer.js`

**תפקיד הקובץ:** רינדור פני השטח, הנהר, הגשרים, העצים, המחצבים ושכבת ערפל המלחמה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(scene, config)` | 23 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_initFowTexture()` | 53 | אתחול והקמת הרכיבים עבור `_initFowTexture`. | 
| `_buildTerrainMesh()` | 78 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildTerrainMesh`). | 
| `_buildWaterPlane()` | 211 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildWaterPlane`). | 
| `_buildStoneBridge()` | 273 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildStoneBridge`). | 
| `_buildTreesAndMines()` | 347 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildTreesAndMines`). | 
| `_setTreeMatricesAt(treeIndex, isChopped)` | 462 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setTreeMatricesAt`). | 
| `syncDepletedTrees(depletedIds = [])` | 506 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`syncDepletedTrees`). | 
| `_buildTileGridOverlay()` | 522 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildTileGridOverlay`). | 
| `setGridVisible(visible)` | 531 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setGridVisible`). | 
| `updateFogOfWar(fowGrid)` | 535 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`updateFogOfWar`). | 
| `update(dtSeconds, fowGrid = null, temporar...)` | 586 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/render/unitInstancingBatcher.js`

**תפקיד הקובץ:** אופטימיזציית GPU באמצעות `InstancedMesh`, איחוד גאומטריות עצמות והסתרת חלקי גוף מתחת לשריון.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `shouldCullOccludedBodyMesh(mesh, equipMap)` | 71 | בדיקת תנאי בוליאני או תקינות מצב (`shouldCullOccludedBodyMesh`). | 
| `mergeBakedJointGeometry(items)` | 122 | פונקציית עזר ולוגיקה ייעודית במודול (`mergeBakedJointGeometry`). | 
| `constructor(key, geometry, material, castShadow...)` | 234 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_allocateMesh(newCapacity)` | 250 | פונקציית עזר ולוגיקה ייעודית במודול (`_allocateMesh`). | 
| `reset()` | 275 | איפוס, ביטול או הסרה של נתונים ישנים (`reset`). | 
| `pushMatrix(mat4)` | 279 | פונקציית עזר ולוגיקה ייעודית במודול (`pushMatrix`). | 
| `commit()` | 305 | פונקציית עזר ולוגיקה ייעודית במודול (`commit`). | 

### `src/render/unitRenderer.js`

**תפקיד הקובץ:** רינדור כל יחידות השדה והגיבורים, בחירת קליפי הליכה/ריצה/תקיפה ועדכון מטריצות ה-Instancing.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `attachMatPropsShader(mat, cacheKey)` | 68 | פונקציית עזר ולוגיקה ייעודית במודול (`attachMatPropsShader`). | 
| `prewarmPool()` | 185 | פונקציית עזר ולוגיקה ייעודית במודול (`prewarmPool`). | 
| `_getPoolKey(team, visualId)` | 217 | שליפת נתונים או מצב נוכחי (`_getPoolKey`). | 
| `_getSharedRingMaterial(teamId)` | 221 | שליפת נתונים או מצב נוכחי (`_getSharedRingMaterial`). | 
| `_getOrCreateBatch(geometry, material, castShadow, rec...)` | 238 | שליפת נתונים או מצב נוכחי (`_getOrCreateBatch`). | 
| `_classifyMeshCategory(mesh)` | 256 | פונקציית עזר ולוגיקה ייעודית במודול (`_classifyMeshCategory`). | 
| `_findAnimatedAncestorJoint(mesh, rootGroup)` | 271 | איתור וסינון הישות או המיקום המתאים ביותר (`_findAnimatedAncestorJoint`). | 
| `_createActorGroupFromSkeletonTemplate(templateKey)` | 282 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_createActorGroupFromSkeletonTemplate`). | 
| `resolveParent(parentName)` | 310 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveParent`). | 
| `_extractMeshEntriesFromRig(group, teamId, visualId)` | 370 | פונקציית עזר ולוגיקה ייעודית במודול (`_extractMeshEntriesFromRig`). | 
| `getParentKey(p)` | 393 | שליפת נתונים או מצב נוכחי (`getParentKey`). | 
| `pruneStaticChildren(node)` | 591 | איפוס, ביטול או הסרה של נתונים ישנים (`pruneStaticChildren`). | 
| `_getHeroBuffBatch(baseBatch, heroBuffVisual, jointNam...)` | 630 | שליפת נתונים או מצב נוכחי (`_getHeroBuffBatch`). | 
| `_resolveHeroVisualId(state)` | 650 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`_resolveHeroVisualId`). | 
| `clearVisualCaches(newAnimationsData = null)` | 680 | איפוס, ביטול או הסרה של נתונים ישנים (`clearVisualCaches`). | 
| `_resolveActorClips(visualId, unitDef)` | 698 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`_resolveActorClips`). | 
| `_pickActionVariant(actor, variants, fallback)` | 750 | איתור וסינון הישות או המיקום המתאים ביותר (`_pickActionVariant`). | 
| `_startShot(actor, clip, shotWindupTicks)` | 772 | הפעלת תהליך או לולאת ריצה ב-`_startShot`. | 
| `_acquireUnitActor(state)` | 778 | פונקציית עזר ולוגיקה ייעודית במודול (`_acquireUnitActor`). | 
| `_releaseUnitActor(actor)` | 853 | פונקציית עזר ולוגיקה ייעודית במודול (`_releaseUnitActor`). | 
| `update(entities, dtSeconds, formationPrevi...)` | 870 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/render/worldEffectsRenderer.js`

**תפקיד הקובץ:** רינדור חיצים ובליסטראות במעוף, טקסט צף, ומד החיים מעל גיבורים (`3.75m` לגיבור רכוב).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_sampleGroundHeightFast(x, z)` | 262 | פונקציית עזר ולוגיקה ייעודית במודול (`_sampleGroundHeightFast`). | 
| `_buildFloatingTextOverlay()` | 266 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildFloatingTextOverlay`). | 
| `updateBurningUnitsFlames(entities, fowGrid = null)` | 368 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`updateBurningUnitsFlames`). | 
| `_bindWorldEvents()` | 402 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindWorldEvents`). | 
| `spawnHeroSpellVisuals(ev)` | 424 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnHeroSpellVisuals`). | 
| `spawnResourceGatherPing(ev)` | 448 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnResourceGatherPing`). | 
| `spawnCollapseExplosion(ev)` | 494 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnCollapseExplosion`). | 
| `spawnTacticalAlertFloatingText(ev)` | 539 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnTacticalAlertFloatingText`). | 
| `spawnBuildingLevelUpAnimation(ev)` | 559 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnBuildingLevelUpAnimation`). | 
| `_isWorldPointVisibleInCamera(wx, wy, wz, maxDist = 175)` | 594 | פונקציית עזר ולוגיקה ייעודית במודול (`_isWorldPointVisibleInCamera`). | 
| `spawnFloatingResourceText(ev)` | 609 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnFloatingResourceText`). | 
| `spawnTowerShotVisuals(ev)` | 636 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnTowerShotVisuals`). | 
| `spawnAnimatorEventSpark(_evt)` | 686 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnAnimatorEventSpark`). | 
| `updateHoverBuildingBadge(hoveredBuildingObj)` | 690 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`updateHoverBuildingBadge`). | 
| `update(dtSeconds)` | 722 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

## 6. ממשק משתמש, סמנים וקלט (`src/ui/`)

### `src/ui/hud/buildingRadialMenu.js`

**תפקיד הקובץ:** תפריט הבניין המעגלי (Radial Menu) — גיוס יחידות וגיבורים, שדרוגים והצגת `HOLD (Full Pop)`.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_bindVisibilityRecovery()` | 40 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindVisibilityRecovery`). | 
| `_injectSpiralAnimationStyles()` | 56 | פונקציית עזר ולוגיקה ייעודית במודול (`_injectSpiralAnimationStyles`). | 
| `_buildDomOverlay()` | 82 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDomOverlay`). | 
| `_buildBottomRightBuildingOrb()` | 105 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildBottomRightBuildingOrb`). | 
| `isBuildingSelected(buildingId)` | 126 | בדיקת תנאי בוליאני או תקינות מצב (`isBuildingSelected`). | 
| `openForBuilding(buildingId, additiveShift = false)` | 130 | פונקציית עזר ולוגיקה ייעודית במודול (`openForBuilding`). | 
| `selectBuildingsOfSameTypeNear(buildingId, additiveShift = false, ...)` | 153 | פונקציית עזר ולוגיקה ייעודית במודול (`selectBuildingsOfSameTypeNear`). | 
| `close()` | 179 | פונקציית עזר ולוגיקה ייעודית במודול (`close`). | 
| `getSelectedBuildings()` | 189 | שליפת נתונים או מצב נוכחי (`getSelectedBuildings`). | 
| `getSelectedBuildingIds()` | 205 | שליפת נתונים או מצב נוכחי (`getSelectedBuildingIds`). | 
| `getSelectedBuilding()` | 209 | שליפת נתונים או מצב נוכחי (`getSelectedBuilding`). | 
| `_getTotalQueueCount(bld)` | 214 | שליפת נתונים או מצב נוכחי (`_getTotalQueueCount`). | 
| `_pickBestBuildingForProduction(selectedBlds, optionId, isUpgrade =...)` | 223 | איתור וסינון הישות או המיקום המתאים ביותר (`_pickBestBuildingForProduction`). | 
| `_pickBestBuildingForCancel(selectedBlds, optionId)` | 258 | איתור וסינון הישות או המיקום המתאים ביותר (`_pickBestBuildingForCancel`). | 
| `_getIconSvgForItem(item)` | 272 | שליפת נתונים או מצב נוכחי (`_getIconSvgForItem`). | 
| `_canAffordCost(cost, eco)` | 292 | פונקציית עזר ולוגיקה ייעודית במודול (`_canAffordCost`). | 
| `_computeTightClusterOffsets(count)` | 302 | חישוב מתמטי/גאומטרי של נתוני המערכת (`_computeTightClusterOffsets`). | 
| `_applySpiralPopAnimation(btn, x, y, index)` | 331 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applySpiralPopAnimation`). | 
| `_formatCostText(cost)` | 339 | פונקציית עזר ולוגיקה ייעודית במודול (`_formatCostText`). | 
| `_formatRefundText(cost)` | 349 | פונקציית עזר ולוגיקה ייעודית במודול (`_formatRefundText`). | 
| `_buildOrbHpSectionHtml(selectedBlds)` | 363 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildOrbHpSectionHtml`). | 
| `_updateLiveHpAndProgressWithoutDomRebuild(selectedBlds, items = null)` | 392 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateLiveHpAndProgressWithoutDomRebuild`). | 
| `update()` | 429 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/ui/hud/buildingRadialRenderers.js`

**תפקיד הקובץ:** פונקציות הרינדור והתצוגה של תפריט הבניין המעגלי וכרטיסי הייצור.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_renderMixedMultiBuildingState(selectedBlds)` | 13 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderMixedMultiBuildingState`. | 
| `_renderUnderConstructionState(bld, def, pct)` | 35 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderUnderConstructionState`. | 
| `_renderPassiveBuildingState(bld, selectedBlds)` | 113 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderPassiveBuildingState`. | 
| `_renderWatchtowerGarrisonState(bld)` | 148 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderWatchtowerGarrisonState`. | 
| `_createGarrisonSlotCircleButton(bld, slotIdx, occ, centerX, centerY...)` | 210 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_createGarrisonSlotCircleButton`). | 
| `_createEjectAllCircleButton(bld, hasAnyGarrison, centerX, cente...)` | 270 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_createEjectAllCircleButton`). | 
| `_renderCompletedBuildingState(primaryBld, selectedBlds, def, items)` | 307 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderCompletedBuildingState`. | 

### `src/ui/hud/cursorSystem.js`

**תפקיד הקובץ:** מערכת סמני העכבר התלת-ממדיים (`CURSOR_RAW_SVGS`, `CURSOR_HOTSPOTS`, `RtsCursorManager`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `buildSvgCursorUrl(svgBody, hotspotX = 4, hotspotY = 4)` | 6 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildSvgCursorUrl`). | 
| `_injectGlobalUiCursorStyles()` | 585 | פונקציית עזר ולוגיקה ייעודית במודול (`_injectGlobalUiCursorStyles`). | 
| `_bindClickStrikeListeners()` | 630 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindClickStrikeListeners`). | 
| `handleRelease()` | 646 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`handleRelease`). | 
| `_applyEffectiveCursor()` | 670 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applyEffectiveCursor`). | 
| `setCursor(cursorType)` | 687 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setCursor`). | 

### `src/ui/hud/devConsole.js`

**תפקיד הקובץ:** קונסול הפיתוח והצ׳יטים (`Enter` או `/`) — פקודות `ai`, `c`/`fow`, `add`, `levelup`, `damage`.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_buildDom()` | 19 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDom`). | 
| `_bindKeys()` | 43 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindKeys`). | 
| `destroy()` | 98 | ניקוי משאבים, מאזינים וזיכרון עבור `destroy`. | 
| `open()` | 115 | פונקציית עזר ולוגיקה ייעודית במודול (`open`). | 
| `close()` | 122 | פונקציית עזר ולוגיקה ייעודית במודול (`close`). | 
| `_submitAndClose()` | 129 | פונקציית עזר ולוגיקה ייעודית במודול (`_submitAndClose`). | 

### `src/ui/hud/hudIcons.js`

**תפקיד הקובץ:** ספריית אייקוני ה-SVG של יחידות, בניינים, משאבים ופקודות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `buildOrbDecorationsSvg(archPath = 'M 38 72 Q 129 60 220 72')` | 492 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildOrbDecorationsSvg`). | 

### `src/ui/hud/hudVisibilityManager.js`

**תפקיד הקובץ:** הסתרה ושחזור של רכיבי ה-HUD בעת מעבר למעבדת האנימציות או היכל הגיבורים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `clearAndHideGameHud(sceneManager = null)` | 27 | איפוס, ביטול או הסרה של נתונים ישנים (`clearAndHideGameHud`). | 
| `restoreGameHud(sceneManager = null)` | 76 | פונקציית עזר ולוגיקה ייעודית במודול (`restoreGameHud`). | 

### `src/ui/hud/minimapHud.js`

**תפקיד הקובץ:** המיני-מפה הטקטית העגולה, הצגת ערפל מלחמה, מצלמה ופקודות תנועה מהמיני-מפה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_getBounds()` | 49 | שליפת נתונים או מצב נוכחי (`_getBounds`). | 
| `_buildDom()` | 61 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDom`). | 
| `_sampleColorForWorld(wx, wz)` | 172 | פונקציית עזר ולוגיקה ייעודית במודול (`_sampleColorForWorld`). | 
| `_precomputeWorldTerrainMap()` | 202 | פונקציית עזר ולוגיקה ייעודית במודול (`_precomputeWorldTerrainMap`). | 
| `_teleportCameraTo(wx, wz)` | 218 | פונקציית עזר ולוגיקה ייעודית במודול (`_teleportCameraTo`). | 
| `_findHomeBaseCoords()` | 235 | איתור וסינון הישות או המיקום המתאים ביותר (`_findHomeBaseCoords`). | 
| `_canvasEventToWorld(e)` | 246 | פונקציית עזר ולוגיקה ייעודית במודול (`_canvasEventToWorld`). | 
| `_worldToCanvasPx(wx, wz, bounds)` | 257 | פונקציית עזר ולוגיקה ייעודית במודול (`_worldToCanvasPx`). | 
| `_bindEvents()` | 267 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindEvents`). | 
| `_syncRimButtonsState()` | 427 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncRimButtonsState`). | 
| `update(nowMs = performance.now())` | 459 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 
| `getCellStateAtMeters(wx, wz)` | 509 | שליפת נתונים או מצב נוכחי (`getCellStateAtMeters`). | 

### `src/ui/hud/rtsCursorManager.js`

**תפקיד הקובץ:** מודול ייצוא מרכזי של סמן העכבר, המיני-מפה, סרגל הפלוגות וחלון הניצחון.

### `src/ui/hud/squadCommandBar.js`

**תפקיד הקובץ:** סרגל הפלוגות התחתון וסרגל הגיבורים העליון.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_buildDom()` | 79 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDom`). | 
| `handleHeroOrSquadCardClick(e)` | 158 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`handleHeroOrSquadCardClick`). | 
| `_updateTopRightHeroesBar(friendlyMap, ecoStates, selectedSet)` | 235 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateTopRightHeroesBar`). | 
| `update(force = false)` | 320 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/ui/hud/topResourceBar.js`

**תפקיד הקובץ:** סרגל המשאבים והאוכלוסייה העליון (`Coins, Wood, Stone, Iron, Pop`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor()` | 9 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_cleanupLegacyHintsOnScreen()` | 14 | פונקציית עזר ולוגיקה ייעודית במודול (`_cleanupLegacyHintsOnScreen`). | 
| `_buildDom()` | 25 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDom`). | 
| `update(eco)` | 50 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/ui/hud/unitTacticalOrb.js`

**תפקיד הקובץ:** הכדור הטקטי ליחידות נבחרות — כפתור ריצה/הליכה, החלפת מבנה, עצירה ולחשי גיבור.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_buildDom()` | 63 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDom`). | 
| `hideSpellBubble()` | 297 | פונקציית עזר ולוגיקה ייעודית במודול (`hideSpellBubble`). | 
| `_renderHeroPerimeterSpells(heroSimState, fallbackName = 'Hero'...)` | 375 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderHeroPerimeterSpells`. | 
| `refreshFormationButtonOnly(selectedList, companyFormations, ec...)` | 565 | פונקציית עזר ולוגיקה ייעודית במודול (`refreshFormationButtonOnly`). | 

### `src/ui/hud/victoryScreenModal.js`

**תפקיד הקובץ:** מסך סיום המשחק (ניצחון / תבוסה) וסטטיסטיקות קרב.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_buildDom()` | 16 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDom`). | 
| `update()` | 70 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/ui/hud/workerBuildChainMenu.js`

**תפקיד הקובץ:** תפריט הבנייה של פועלים לבחירת מבנים חדשים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_buildDom()` | 20 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDom`). | 
| `_showBuildingTooltip(def)` | 90 | פונקציית עזר ולוגיקה ייעודית במודול (`_showBuildingTooltip`). | 
| `setVisible(visible)` | 108 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setVisible`). | 
| `refreshStyles(activePlacementType)` | 117 | פונקציית עזר ולוגיקה ייעודית במודול (`refreshStyles`). | 

### `src/ui/input/formationGhostPreview.js`

**תפקיד הקובץ:** רינדור סמני המיקום התלת-ממדיים (Ghosts) של חיילי הפלוגה בזמן גרירת מבנה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(scene, sampleGroundYFn)` | 48 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `_createUnitIconTexture(unitType)` | 60 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_createUnitIconTexture`). | 
| `_buildMeshes()` | 216 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildMeshes`). | 
| `hide()` | 309 | פונקציית עזר ולוגיקה ייעודית במודול (`hide`). | 
| `_restoreNormalAppearance()` | 317 | פונקציית עזר ולוגיקה ייעודית במודול (`_restoreNormalAppearance`). | 
| `triggerCommitFlash()` | 331 | פונקציית עזר ולוגיקה ייעודית במודול (`triggerCommitFlash`). | 
| `stepFlash(dtSeconds)` | 341 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`stepFlash`). | 
| `update(dragStartWorld, dragCurrentWorld, d...)` | 362 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/ui/input/formationInputHandlers.js`

**תפקיד הקובץ:** מאזיני עכבר ומקלדת של `FormationPreview3D` — לחיצות ימניות, גרירת קו מבנה, `Alt` ושיגור לחשים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `onKeyDown(e)` | 21 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onKeyDown`). | 
| `onKeyUp(e)` | 120 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onKeyUp`). | 
| `onMouseDown(e)` | 133 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseDown`). | 
| `onMouseMove(e)` | 207 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseMove`). | 
| `onMouseUp(e)` | 279 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseUp`). | 
| `onDblClick(e)` | 368 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onDblClick`). | 
| `_update3DGhostPreview()` | 378 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_update3DGhostPreview`). | 
| `update(dtSeconds, nowMs = performance.now())` | 561 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/ui/input/formationPreview3D.js`

**תפקיד הקובץ:** ניהול פקודות טקטיות לפלוגות נבחרות, תצוגה מקדימה של מבנה בגרירה, החלפת מבנים וריצה/הליכה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `onWindowBlur()` | 317 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onWindowBlur`). | 
| `isCompanySelected(companyId)` | 324 | בדיקת תנאי בוליאני או תקינות מצב (`isCompanySelected`). | 
| `isCompanyHovered(companyId)` | 328 | בדיקת תנאי בוליאני או תקינות מצב (`isCompanyHovered`). | 
| `isEnemyCompanyHovered(companyId)` | 336 | בדיקת תנאי בוליאני או תקינות מצב (`isEnemyCompanyHovered`). | 
| `_isActivelyStretchingFormation(e = this._lastMouseEvent)` | 344 | פונקציית עזר ולוגיקה ייעודית במודול (`_isActivelyStretchingFormation`). | 
| `syncCursorState(e = this._lastMouseEvent)` | 355 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`syncCursorState`). | 
| `getSelectedWorkerCompanyIds()` | 382 | שליפת נתונים או מצב נוכחי (`getSelectedWorkerCompanyIds`). | 
| `_hideAllSpellTargetPreviews()` | 386 | פונקציית עזר ולוגיקה ייעודית במודול (`_hideAllSpellTargetPreviews`). | 
| `clearSelection()` | 394 | איפוס, ביטול או הסרה של נתונים ישנים (`clearSelection`). | 
| `cancelRightDrag()` | 406 | בדיקת תנאי בוליאני או תקינות מצב (`cancelRightDrag`). | 
| `spawnEphemeralClickMarker(worldPoint, orderType = 'MOVE', rad...)` | 414 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnEphemeralClickMarker`). | 
| `issueMinimapOrderAtWorld(wx, wz, mouseEvent = null, explicit...)` | 422 | בדיקת תנאי בוליאני או תקינות מצב (`issueMinimapOrderAtWorld`). | 
| `_getHeroAnchorWorldPos(companyId, fallbackX = 0, fallbackZ...)` | 462 | שליפת נתונים או מצב נוכחי (`_getHeroAnchorWorldPos`). | 
| `_conformGroundSpellMesh(mesh, centerX, centerZ, scaleX, sca...)` | 479 | פונקציית עזר ולוגיקה ייעודית במודול (`_conformGroundSpellMesh`). | 
| `_conformLineSpellFromHero(mesh, hx, hz, tx, tz, width, len, h...)` | 501 | פונקציית עזר ולוגיקה ייעודית במודול (`_conformLineSpellFromHero`). | 
| `commitPendingSpellAtWorld(wx, wz, mouseEvent = null)` | 529 | פונקציית עזר ולוגיקה ייעודית במודול (`commitPendingSpellAtWorld`). | 
| `_buildEnrichedSelectedDescriptors()` | 607 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildEnrichedSelectedDescriptors`). | 
| `notifyGarrisonOrder(companyIds, towerX, towerZ, queueSh...)` | 661 | פונקציית עזר ולוגיקה ייעודית במודול (`notifyGarrisonOrder`). | 
| `notifyWorkerBuildOrder(workerCompanyIds, targetX, targetZ,...)` | 674 | פונקציית עזר ולוגיקה ייעודית במודול (`notifyWorkerBuildOrder`). | 
| `setTargetingMode(mode)` | 687 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setTargetingMode`). | 
| `toggleSelectedFireMode()` | 698 | פונקציית עזר ולוגיקה ייעודית במודול (`toggleSelectedFireMode`). | 
| `toggleSelectedGait(forceRun = null)` | 724 | פונקציית עזר ולוגיקה ייעודית במודול (`toggleSelectedGait`). | 
| `cycleSelectedFormation()` | 790 | פונקציית עזר ולוגיקה ייעודית במודול (`cycleSelectedFormation`). | 
| `issueStopCommand()` | 839 | בדיקת תנאי בוליאני או תקינות מצב (`issueStopCommand`). | 
| `_refreshRadialPanelUI(friendlyMap = null)` | 858 | פונקציית עזר ולוגיקה ייעודית במודול (`_refreshRadialPanelUI`). | 
| `_stageShiftPatrolPoint(worldPoint)` | 922 | פונקציית עזר ולוגיקה ייעודית במודול (`_stageShiftPatrolPoint`). | 
| `_commitStagedPatrolRoute()` | 928 | פונקציית עזר ולוגיקה ייעודית במודול (`_commitStagedPatrolRoute`). | 

### `src/ui/input/inputRouter.js`

**תפקיד הקובץ:** ניתוב אירועי עכבר ומקלדת בין שכבות הממשק והעולם התלת-ממדי.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(domElement)` | 2 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `registerLayer(id, handler, priority = 0)` | 8 | פונקציית עזר ולוגיקה ייעודית במודול (`registerLayer`). | 
| `_isTextInputFocused()` | 14 | פונקציית עזר ולוגיקה ייעודית במודול (`_isTextInputFocused`). | 
| `_notifyWindowBlur()` | 19 | פונקציית עזר ולוגיקה ייעודית במודול (`_notifyWindowBlur`). | 
| `_bindDomEvents()` | 35 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindDomEvents`). | 

### `src/ui/input/orderQueueEngine.js`

**תפקיד הקובץ:** ניהול תור פקודות ויזואלי (`Shift`) ומסלולי סיור (`Patrol`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor()` | 6 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `clearAllForCompanies(companyIds)` | 12 | איפוס, ביטול או הסרה של נתונים ישנים (`clearAllForCompanies`). | 
| `clearStagedPatrol()` | 21 | איפוס, ביטול או הסרה של נתונים ישנים (`clearStagedPatrol`). | 
| `hasStagedPatrol()` | 25 | בדיקת תנאי בוליאני או תקינות מצב (`hasStagedPatrol`). | 
| `hasActiveVisualOrder(companyId)` | 29 | בדיקת תנאי בוליאני או תקינות מצב (`hasActiveVisualOrder`). | 
| `_hasPatrolInQueue(cid)` | 34 | פונקציית עזר ולוגיקה ייעודית במודול (`_hasPatrolInQueue`). | 
| `_checkAndNormalizePatrolLoopVisuals(patrolItems)` | 39 | בדיקת תנאי בוליאני או תקינות מצב (`_checkAndNormalizePatrolLoopVisuals`). | 
| `enqueueGatherOrder(workerCompanyIds, resourceX, resour...)` | 59 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`enqueueGatherOrder`). | 
| `enqueueDropoffOrder(workerCompanyIds, campX, campZ, que...)` | 85 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`enqueueDropoffOrder`). | 
| `enqueueGarrisonOrder(companyIds, towerX, towerZ, queueSh...)` | 111 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`enqueueGarrisonOrder`). | 
| `enqueueBuildOrder(workerCompanyIds, targetX, targetZ,...)` | 137 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`enqueueBuildOrder`). | 
| `stageShiftPatrolPoint(worldPoint, descriptors)` | 178 | פונקציית עזר ולוגיקה ייעודית במודול (`stageShiftPatrolPoint`). | 
| `consumeStagedPatrolRoute(descriptors)` | 225 | פונקציית עזר ולוגיקה ייעודית במודול (`consumeStagedPatrolRoute`). | 
| `_syncWorkerBuildQueuePaths(ecoStates, buildings, nowMs)` | 348 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncWorkerBuildQueuePaths`). | 

### `src/ui/input/unitSelectionController.js`

**תפקיד הקובץ:** ניהול בחירת פלוגות בלחיצה, תיבת גרירה (Marquee), בחירה כפולה וקבוצות שליטה (`Ctrl+1..9`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_buildMarqueeDom()` | 56 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildMarqueeDom`). | 
| `showMarqueeRect(x0, y0, x1, y1)` | 67 | פונקציית עזר ולוגיקה ייעודית במודול (`showMarqueeRect`). | 
| `hideMarquee()` | 79 | פונקציית עזר ולוגיקה ייעודית במודול (`hideMarquee`). | 
| `isCompanySelected(companyId)` | 83 | בדיקת תנאי בוליאני או תקינות מצב (`isCompanySelected`). | 
| `gatherFriendlyCompanies()` | 87 | פונקציית עזר ולוגיקה ייעודית במודול (`gatherFriendlyCompanies`). | 
| `getSelectedWorkerCompanyIds(friendlyMap = null)` | 150 | שליפת נתונים או מצב נוכחי (`getSelectedWorkerCompanyIds`). | 
| `buildSelectedCompanyDescriptors(friendlyMap = null)` | 163 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildSelectedCompanyDescriptors`). | 
| `emitSelectionChanged(friendlyMap = null)` | 174 | פונקציית עזר ולוגיקה ייעודית במודול (`emitSelectionChanged`). | 
| `pruneMissingSelections(friendlyMap)` | 190 | איפוס, ביטול או הסרה של נתונים ישנים (`pruneMissingSelections`). | 
| `selectCompanyByClick(clientX, clientY, additiveShift = f...)` | 205 | פונקציית עזר ולוגיקה ייעודית במודול (`selectCompanyByClick`). | 
| `selectCompaniesInMarquee(minX, minY, maxX, maxY, additiveShi...)` | 228 | פונקציית עזר ולוגיקה ייעודית במודול (`selectCompaniesInMarquee`). | 
| `selectAllOfSameUnitType(clientX, clientY, additiveShift = f...)` | 254 | פונקציית עזר ולוגיקה ייעודית במודול (`selectAllOfSameUnitType`). | 
| `getIdleWorkerCompanies(friendlyMap = null)` | 285 | שליפת נתונים או מצב נוכחי (`getIdleWorkerCompanies`). | 
| `selectNextIdleWorker(focusCamera = true)` | 309 | פונקציית עזר ולוגיקה ייעודית במודול (`selectNextIdleWorker`). | 
| `selectAllIdleWorkers()` | 329 | פונקציית עזר ולוגיקה ייעודית במודול (`selectAllIdleWorkers`). | 
| `assignControlGroup(groupNumber)` | 341 | הגדרה והחלה של ערכים או פקודות על האובייקט (`assignControlGroup`). | 
| `selectControlGroup(groupNumber, focusCameraOnDoubleTap...)` | 348 | פונקציית עזר ולוגיקה ייעודית במודול (`selectControlGroup`). | 
| `selectAllCombatUnits()` | 401 | פונקציית עזר ולוגיקה ייעודית במודול (`selectAllCombatUnits`). | 

### `src/ui/input/workerPlacementController.js`

**תפקיד הקובץ:** מצב הצבת בניין חדש על ידי פועלים עם בדיקת תקינות בזמן אמת.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_bindBusEvents()` | 84 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindBusEvents`). | 
| `onWindowBlur()` | 92 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onWindowBlur`). | 
| `_facingDirToThreeYaw(facingDir)` | 96 | פונקציית עזר ולוגיקה ייעודית במודול (`_facingDirToThreeYaw`). | 
| `_canAffordBuilding(def)` | 100 | פונקציית עזר ולוגיקה ייעודית במודול (`_canAffordBuilding`). | 
| `startPlacementMode(buildingType)` | 116 | הפעלת תהליך או לולאת ריצה ב-`startPlacementMode`. | 
| `cancelPlacementMode()` | 146 | בדיקת תנאי בוליאני או תקינות מצב (`cancelPlacementMode`). | 
| `_validatePlacementClient(type, xMeters, zMeters)` | 154 | פונקציית עזר ולוגיקה ייעודית במודול (`_validatePlacementClient`). | 
| `_syncWorkerSelectionState(eventPayload = null)` | 231 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncWorkerSelectionState`). | 
| `_commitBuildingPlacement(placePos, shiftKey)` | 252 | פונקציית עזר ולוגיקה ייעודית במודול (`_commitBuildingPlacement`). | 
| `onKeyDown(e)` | 290 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onKeyDown`). | 
| `onWheel(e)` | 298 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onWheel`). | 
| `onMouseMove(e)` | 307 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseMove`). | 
| `onMouseUp(e)` | 354 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseUp`). | 
| `onDblClick(e)` | 364 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onDblClick`). | 
| `onMouseDown(e)` | 395 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`onMouseDown`). | 
| `update()` | 722 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 

### `src/ui/input/worldPicker.js`

**תפקיד הקובץ:** בחירה תלת-ממדית של שטח, עצים, מכרות, בניינים ויחידות (כולל קופסת פגיעה מכפות הרגליים לראש מכל זווית מצלמה).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `raycastTerrain(mouseEvent)` | 33 | פונקציית עזר ולוגיקה ייעודית במודול (`raycastTerrain`). | 
| `ensureTreeCoordsCached()` | 70 | פונקציית עזר ולוגיקה ייעודית במודול (`ensureTreeCoordsCached`). | 
| `overlapsResourceNodeClient(xMeters, zMeters, footprintRadiusMe...)` | 85 | פונקציית עזר ולוגיקה ייעודית במודול (`overlapsResourceNodeClient`). | 
| `findResourceNodeAtMouse(mouseEvent, terrainHitPoint)` | 110 | איתור וסינון הישות או המיקום המתאים ביותר (`findResourceNodeAtMouse`). | 
| `isBuildingVisibleInFow(b)` | 205 | בדיקת תנאי בוליאני או תקינות מצב (`isBuildingVisibleInFow`). | 
| `findBuildingNear(xMeters, zMeters, marginMeters = 0.5)` | 215 | איתור וסינון הישות או המיקום המתאים ביותר (`findBuildingNear`). | 
| `isEnemyVisibleInFow(ent)` | 228 | בדיקת תנאי בוליאני או תקינות מצב (`isEnemyVisibleInFow`). | 
| `findEnemyEntityNearWorldPoint(xMeters, zMeters, maxRadiusMeters =...)` | 238 | איתור וסינון הישות או המיקום המתאים ביותר (`findEnemyEntityNearWorldPoint`). | 
| `_getUnitBoundingBoxDimensions(ent)` | 254 | שליפת נתונים או מצב נוכחי (`_getUnitBoundingBoxDimensions`). | 
| `_evaluateUnitHitDistanceSq(ent, clientX, clientY, rect, ray, m...)` | 273 | דגימה וחישוב ערך בנקודה או בזמן נתון (`_evaluateUnitHitDistanceSq`). | 
| `findEnemyUnitOnScreen(clientX, clientY, maxPixelRadius = 36)` | 317 | איתור וסינון הישות או המיקום המתאים ביותר (`findEnemyUnitOnScreen`). | 
| `findNearestUnitOnScreen(clientX, clientY, teamFilter = 1, m...)` | 340 | איתור וסינון הישות או המיקום המתאים ביותר (`findNearestUnitOnScreen`). | 

## 7. היכל הגיבורים ומעבדת האנימציות (`src/tools/heroes/`, `src/tools/studio/`)

### `src/tools/heroes/hallOfHeroesApp.js`

**תפקיד הקובץ:** אפליקציית היכל הגיבורים (`HallOfHeroesApp`) — עריכת גיבורים, פרמטרים, עלויות וזמן התייצרות (`trainTimeSec`).

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_updateSaveChip(state, msg = '')` | 101 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateSaveChip`). | 
| `_toast(message, ms = 2000)` | 119 | פונקציית עזר ולוגיקה ייעודית במודול (`_toast`). | 
| `_buildDOM()` | 128 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildDOM`). | 
| `_initThreePreview()` | 438 | אתחול והקמת הרכיבים עבור `_initThreePreview`. | 
| `endDrag()` | 539 | פונקציית עזר ולוגיקה ייעודית במודול (`endDrag`). | 
| `_updateCameraOrbit()` | 555 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateCameraOrbit`). | 
| `_spawnHeroPreviewModel()` | 567 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`_spawnHeroPreviewModel`). | 
| `_playPreviewAnim(animKey)` | 602 | פונקציית עזר ולוגיקה ייעודית במודול (`_playPreviewAnim`). | 
| `_renderAnimButtons()` | 649 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderAnimButtons`. | 
| `_renderAllPanels()` | 684 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderAllPanels`. | 
| `_renderHeroList()` | 693 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderHeroList`. | 
| `_renderPreviewHeader()` | 724 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderPreviewHeader`. | 
| `_renderEditState()` | 745 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderEditState`. | 
| `_renderRightParametersPanel()` | 776 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderRightParametersPanel`. | 
| `numRow(field, label, val, step = 1, min = ...)` | 808 | פונקציית עזר ולוגיקה ייעודית במודול (`numRow`). | 

### `src/tools/heroes/hallOfHeroesEvents.js`

**תפקיד הקובץ:** ניהול אירועי הקלט, השמירה והניווט בהיכל הגיבורים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_bindEvents()` | 45 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindEvents`). | 
| `qs(s)` | 46 | פונקציית עזר ולוגיקה ייעודית במודול (`qs`). | 
| `hideCtxMenu()` | 352 | פונקציית עזר ולוגיקה ייעודית במודול (`hideCtxMenu`). | 
| `_syncAllInputsFromDom()` | 424 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncAllInputsFromDom`). | 
| `_startLoop()` | 456 | הפעלת תהליך או לולאת ריצה ב-`_startLoop`. | 
| `frame(now)` | 459 | פונקציית עזר ולוגיקה ייעודית במודול (`frame`). | 
| `destroy()` | 513 | ניקוי משאבים, מאזינים וזיכרון עבור `destroy`. | 

### `src/tools/heroes/hallOfHeroesSpellsWorkspace.js`

**תפקיד הקובץ:** סביבת עריכת עץ הלחשים ורמות 1–10 בהיכל הגיבורים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_ensureSchedule10(hero)` | 49 | פונקציית עזר ולוגיקה ייעודית במודול (`_ensureSchedule10`). | 
| `_computeTimelineState(hero)` | 58 | חישוב מתמטי/גאומטרי של נתוני המערכת (`_computeTimelineState`). | 
| `_arePrerequisitesMet(spellDef, spellRanks, hero)` | 93 | פונקציית עזר ולוגיקה ייעודית במודול (`_arePrerequisitesMet`). | 
| `_handleSkipLevel()` | 116 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_handleSkipLevel`). | 
| `_handleChooseSpell(spellId, treeId)` | 142 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_handleChooseSpell`). | 
| `_formatRankStatsLine(rankObj)` | 203 | פונקציית עזר ולוגיקה ייעודית במודול (`_formatRankStatsLine`). | 
| `_buildSpellTooltipHtml(sp, currentRank)` | 219 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildSpellTooltipHtml`). | 
| `_renderSpellsWorkspace()` | 281 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderSpellsWorkspace`. | 
| `renderNodeAt(sp, treeId, xPct, yPct, isHybrid = ...)` | 361 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`renderNodeAt`. | 
| `placeTierRow(list, yCoord)` | 463 | פונקציית עזר ולוגיקה ייעודית במודול (`placeTierRow`). | 
| `_renderSpellVfxBar()` | 646 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderSpellVfxBar`. | 
| `_positionTooltip(e, tipEl)` | 690 | פונקציית עזר ולוגיקה ייעודית במודול (`_positionTooltip`). | 
| `_openSpellEditModal(spellId)` | 702 | פונקציית עזר ולוגיקה ייעודית במודול (`_openSpellEditModal`). | 
| `_closeSpellEditModal()` | 879 | פונקציית עזר ולוגיקה ייעודית במודול (`_closeSpellEditModal`). | 
| `_saveSpellEditModal()` | 885 | פונקציית עזר ולוגיקה ייעודית במודול (`_saveSpellEditModal`). | 

### `src/tools/heroes/heroStateManager.js`

**תפקיד הקובץ:** מנהל מצב הגיבורים (`HeroStateManager`) — טעינה ושמירה ב-`localStorage`, מיזוג אנימציות (`buildCombinedVisualsData`) ורינדור פורטרטים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `deepClone(obj)` | 22 | פונקציית עזר ולוגיקה ייעודית במודול (`deepClone`). | 
| `normalizeSpellId(spellId)` | 33 | פונקציית עזר ולוגיקה ייעודית במודול (`normalizeSpellId`). | 
| `hashString(str)` | 41 | בדיקת תנאי בוליאני או תקינות מצב (`hashString`). | 
| `getUniqueHeroSpellIds(heroDef)` | 53 | שליפת נתונים או מצב נוכחי (`getUniqueHeroSpellIds`). | 
| `getHeroSpellClipBases(heroDef)` | 71 | שליפת נתונים או מצב נוכחי (`getHeroSpellClipBases`). | 
| `getSpellTreesForClass(heroesData, heroClass = 'warrior')` | 78 | שליפת נתונים או מצב נוכחי (`getSpellTreesForClass`). | 
| `findSpellDef(heroesData, rawSpellId)` | 91 | איתור וסינון הישות או המיקום המתאים ביותר (`findSpellDef`). | 
| `heroHasSecondaryLoadout(heroDef)` | 118 | פונקציית עזר ולוגיקה ייעודית במודול (`heroHasSecondaryLoadout`). | 
| `getEquipmentWeaponMode(equipment)` | 134 | שליפת נתונים או מצב נוכחי (`getEquipmentWeaponMode`). | 
| `loadHeroesDataFromStorage()` | 147 | פונקציית עזר ולוגיקה ייעודית במודול (`loadHeroesDataFromStorage`). | 
| `applySavedSpellEdits(sp, oldSp)` | 159 | הגדרה והחלה של ערכים או פקודות על האובייקט (`applySavedSpellEdits`). | 
| `buildCombinedVisualsData(unitsVisualsData = defaultUnitsJson...)` | 286 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`buildCombinedVisualsData`). | 
| `getOrRenderHeroPortraitUrl(heroId, heroesData = null, options ...)` | 419 | שליפת נתונים או מצב נוכחי (`getOrRenderHeroPortraitUrl`). | 
| `invalidateHeroPortraitCache(heroId = null)` | 453 | פונקציית עזר ולוגיקה ייעודית במודול (`invalidateHeroPortraitCache`). | 
| `_emit(state, message = '')` | 469 | פונקציית עזר ולוגיקה ייעודית במודול (`_emit`). | 
| `getStudioViewData(baseUnitsData = defaultUnitsJson)` | 477 | שליפת נתונים או מצב נוכחי (`getStudioViewData`). | 
| `syncFromStudioView()` | 516 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`syncFromStudioView`). | 
| `isHeroClipName(clipName)` | 528 | בדיקת תנאי בוליאני או תקינות מצב (`isHeroClipName`). | 
| `ensureSpellAnimationSlotsForHero(heroDef)` | 566 | פונקציית עזר ולוגיקה ייעודית במודול (`ensureSpellAnimationSlotsForHero`). | 
| `setHeroPortrait(heroId, dataUrl)` | 615 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setHeroPortrait`). | 
| `applyHeroClassTemplate(heroId, newClass = 'warrior')` | 630 | הגדרה והחלה של ערכים או פקודות על האובייקט (`applyHeroClassTemplate`). | 
| `deleteHero(heroId)` | 708 | איפוס, ביטול או הסרה של נתונים ישנים (`deleteHero`). | 
| `saveDraft()` | 720 | פונקציית עזר ולוגיקה ייעודית במודול (`saveDraft`). | 
| `scheduleSave(delayMs = SAVE_DELAY_MS)` | 747 | פונקציית עזר ולוגיקה ייעודית במודול (`scheduleSave`). | 
| `flush()` | 754 | פונקציית עזר ולוגיקה ייעודית במודול (`flush`). | 
| `exportHeroesJson(filename = 'heroes.json')` | 758 | פונקציית עזר ולוגיקה ייעודית במודול (`exportHeroesJson`). | 
| `importHeroesJsonText(text)` | 769 | פונקציית עזר ולוגיקה ייעודית במודול (`importHeroesJsonText`). | 
| `resetToDefault()` | 785 | איפוס, ביטול או הסרה של נתונים ישנים (`resetToDefault`). | 
| `snapshot()` | 797 | פונקציית עזר ולוגיקה ייעודית במודול (`snapshot`). | 
| `restoreSnapshot(text)` | 802 | פונקציית עזר ולוגיקה ייעודית במודול (`restoreSnapshot`). | 
| `destroy()` | 808 | ניקוי משאבים, מאזינים וזיכרון עבור `destroy`. | 

### `src/tools/studio/clipEditing.js`

**תפקיד הקובץ:** יצירה, שכפול, איפוס וניקוי (`sanitizeUnitsData`, `pruneDanglingRefs`) של קליפי אנימציה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `clone(o)` | 30 | פונקציית עזר ולוגיקה ייעודית במודול (`clone`). | 
| `defaultKeyframeClip(base)` | 32 | פונקציית עזר ולוגיקה ייעודית במודול (`defaultKeyframeClip`). | 
| `defaultProceduralClip()` | 46 | פונקציית עזר ולוגיקה ייעודית במודול (`defaultProceduralClip`). | 
| `editTargetName(unitId, faction, base, scope, varia...)` | 51 | פונקציית עזר ולוגיקה ייעודית במודול (`editTargetName`). | 
| `readClipName(data, unitId, faction, base, scope,...)` | 58 | שליפת נתונים או מצב נוכחי (`readClipName`). | 
| `normalizeKeyframeClip(clip, base)` | 64 | פונקציית עזר ולוגיקה ייעודית במודול (`normalizeKeyframeClip`). | 
| `publishFields(data, unitId, faction, base, name)` | 79 | פונקציית עזר ולוגיקה ייעודית במודול (`publishFields`). | 
| `ensureKeyframeClip(data, unitId, faction, base, scope,...)` | 92 | פונקציית עזר ולוגיקה ייעודית במודול (`ensureKeyframeClip`). | 
| `createClipVariation(data, unitId, faction, base, scope,...)` | 109 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`createClipVariation`). | 
| `deleteClipVariation(data, unitId, faction, base, scope,...)` | 126 | איפוס, ביטול או הסרה של נתונים ישנים (`deleteClipVariation`). | 
| `ensureProceduralClip(data, unitId, faction, base, scope)` | 145 | פונקציית עזר ולוגיקה ייעודית במודול (`ensureProceduralClip`). | 
| `resetClip(data, defaults, unitId, faction, ba...)` | 166 | איפוס, ביטול או הסרה של נתונים ישנים (`resetClip`). | 
| `pruneDanglingRefs(data, report = null)` | 186 | איפוס, ביטול או הסרה של נתונים ישנים (`pruneDanglingRefs`). | 
| `escapeRe(s)` | 213 | פונקציית עזר ולוגיקה ייעודית במודול (`escapeRe`). | 
| `strip(clip)` | 214 | פונקציית עזר ולוגיקה ייעודית במודול (`strip`). | 
| `hasKeys(clip)` | 215 | בדיקת תנאי בוליאני או תקינות מצב (`hasKeys`). | 
| `sanitizeUnitsData(data)` | 226 | פונקציית עזר ולוגיקה ייעודית במודול (`sanitizeUnitsData`). | 
| `hasRepeatedPrefix(name)` | 236 | בדיקת תנאי בוליאני או תקינות מצב (`hasRepeatedPrefix`). | 

### `src/tools/studio/clipResolver.js`

**תפקיד הקובץ:** פתרון שמות קליפים, וריאציות (`__v2`), קליפי לחימה, תנועה ולחשים.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `isMoveClip(base)` | 48 | בדיקת תנאי בוליאני או תקינות מצב (`isMoveClip`). | 
| `isAttackClip(base)` | 49 | בדיקת תנאי בוליאני או תקינות מצב (`isAttackClip`). | 
| `isSpellClip(base)` | 50 | בדיקת תנאי בוליאני או תקינות מצב (`isSpellClip`). | 
| `stripVariantSuffix(name)` | 52 | פונקציית עזר ולוגיקה ייעודית במודול (`stripVariantSuffix`). | 
| `variantIndexOf(name)` | 57 | פונקציית עזר ולוגיקה ייעודית במודול (`variantIndexOf`). | 
| `withVariantIndex(baseClipName, variantIdx = 1)` | 63 | פונקציית עזר ולוגיקה ייעודית במודול (`withVariantIndex`). | 
| `clipNameFor(unitId, faction, base, variantIdx = 1)` | 69 | פונקציית עזר ולוגיקה ייעודית במודול (`clipNameFor`). | 
| `unitClipNameFor(unitId, base, variantIdx = 1)` | 72 | פונקציית עזר ולוגיקה ייעודית במודול (`unitClipNameFor`). | 
| `baseOfClip(name)` | 76 | פונקציית עזר ולוגיקה ייעודית במודול (`baseOfClip`). | 
| `clipExists(anims, base, name)` | 91 | פונקציית עזר ולוגיקה ייעודית במודול (`clipExists`). | 
| `resolveClip(data, unitId, faction, base, varian...)` | 102 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveClip`). | 
| `resolveClipVariants(data, unitId, faction, base, scope ...)` | 121 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveClipVariants`). | 
| `getCombatBase(unitDef, faction)` | 159 | שליפת נתונים או מצב נוכחי (`getCombatBase`). | 
| `getLocomotionBase(unitDef, faction)` | 168 | שליפת נתונים או מצב נוכחי (`getLocomotionBase`). | 
| `resolveCombatClip(data, unitId, faction)` | 176 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveCombatClip`). | 
| `resolveLocomotionClip(data, unitId, faction)` | 179 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveLocomotionClip`). | 
| `resolveIdleClip(data, unitId, faction)` | 182 | פתרון ומיפוי של מזהה, התנגשות או קליפ אנימציה (`resolveIdleClip`). | 

### `src/tools/studio/gizmoController.js`

**תפקיד הקובץ:** שליטה בגיזמו התלת-ממדי (`TransformControls`) לסיבוב והזזת עצמות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_createJointMarker()` | 55 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_createJointMarker`). | 
| `_bindEvents()` | 64 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindEvents`). | 
| `_syncMarkerPosition()` | 90 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncMarkerPosition`). | 
| `attachToObject(object3d, mode = 'rotate')` | 96 | פונקציית עזר ולוגיקה ייעודית במודול (`attachToObject`). | 
| `setEnabled(enabled)` | 110 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setEnabled`). | 
| `getMode()` | 116 | שליפת נתונים או מצב נוכחי (`getMode`). | 
| `setGizmoMode(mode)` | 118 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setGizmoMode`). | 
| `detach()` | 122 | פונקציית עזר ולוגיקה ייעודית במודול (`detach`). | 
| `snapToRtsGameView(distance = 18, focusPoint = new THR...)` | 128 | פונקציית עזר ולוגיקה ייעודית במודול (`snapToRtsGameView`). | 
| `snapToCloseupView()` | 140 | פונקציית עזר ולוגיקה ייעודית במודול (`snapToCloseupView`). | 
| `update()` | 147 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 
| `dispose()` | 152 | ניקוי משאבים, מאזינים וזיכרון עבור `dispose`. | 

### `src/tools/studio/healthCheck.js`

**תפקיד הקובץ:** בדיקת תקינות אוטומטית למודלים, שלדים ואנימציות במעבדה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `isNum(v)` | 27 | בדיקת תנאי בוליאני או תקינות מצב (`isNum`). | 
| `isVec(v, n = 3)` | 28 | בדיקת תנאי בוליאני או תקינות מצב (`isVec`). | 
| `collectJoints(tree, out = new Set()` | 31 | פונקציית עזר ולוגיקה ייעודית במודול (`collectJoints`). | 
| `eachNode(tree, fn, path = '')` | 39 | פונקציית עזר ולוגיקה ייעודית במודול (`eachNode`). | 
| `runHealthCheck(data)` | 46 | פונקציית עזר ולוגיקה ייעודית במודול (`runHealthCheck`). | 
| `add(level, area, message, goto)` | 48 | פונקציית עזר ולוגיקה ייעודית במודול (`add`). | 
| `checkMeshes(owner, jointName, node, goto)` | 81 | בדיקת תנאי בוליאני או תקינות מצב (`checkMeshes`). | 
| `factionsOf(u)` | 110 | פונקציית עזר ולוגיקה ייעודית במודול (`factionsOf`). | 
| `knownPrefix(name)` | 186 | פונקציית עזר ולוגיקה ייעודית במודול (`knownPrefix`). | 
| `count(type)` | 229 | פונקציית עזר ולוגיקה ייעודית במודול (`count`). | 
| `finish(issues)` | 290 | פונקציית עזר ולוגיקה ייעודית במודול (`finish`). | 

### `src/tools/studio/inspectorPanel.js`

**תפקיד הקובץ:** פאנל ה-Inspector לעריכת סיבוב/מיקום עצמות ופרמטרים במעבדה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `_el(id)` | 69 | פונקציית עזר ולוגיקה ייעודית במודול (`_el`). | 
| `setKeyContext(kf)` | 107 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setKeyContext`). | 
| `setProcedural(clip)` | 117 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setProcedural`). | 
| `_fillProcedural()` | 123 | פונקציית עזר ולוגיקה ייעודית במודול (`_fillProcedural`). | 
| `_values()` | 132 | פונקציית עזר ולוגיקה ייעודית במודול (`_values`). | 
| `syncUI()` | 139 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`syncUI`). | 
| `switchTab(tab)` | 153 | פונקציית עזר ולוגיקה ייעודית במודול (`switchTab`). | 
| `_renderUI()` | 167 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderUI`. | 
| `row(group, i)` | 169 | פונקציית עזר ולוגיקה ייעודית במודול (`row`). | 
| `procRow(id, label, step)` | 180 | פונקציית עזר ולוגיקה ייעודית במודול (`procRow`). | 
| `_bindEvents()` | 264 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindEvents`). | 
| `_onField(field, value, source)` | 323 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onField`). | 
| `_flash(buttonId, text)` | 338 | פונקציית עזר ולוגיקה ייעודית במודול (`_flash`). | 

### `src/tools/studio/keyTracks.js`

**תפקיד הקובץ:** מניפולציה על מסילות Keyframes — הוספה, מחיקה, מיון ומיגרציה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `ZERO()` | 24 | פונקציית עזר ולוגיקה ייעודית במודול (`ZERO`). | 
| `copy3(v)` | 25 | פונקציית עזר ולוגיקה ייעודית במודול (`copy3`). | 
| `byT(a, b)` | 26 | פונקציית עזר ולוגיקה ייעודית במודול (`byT`). | 
| `clamp01(t)` | 27 | פונקציית עזר ולוגיקה ייעודית במודול (`clamp01`). | 
| `smoothstep01(t)` | 29 | פונקציית עזר ולוגיקה ייעודית במודול (`smoothstep01`). | 
| `easeInOutQuad(t)` | 30 | פונקציית עזר ולוגיקה ייעודית במודול (`easeInOutQuad`). | 
| `isOwner(key, prop)` | 32 | בדיקת תנאי בוליאני או תקינות מצב (`isOwner`). | 
| `ownedKeys(track, prop)` | 33 | פונקציית עזר ולוגיקה ייעודית במודול (`ownedKeys`). | 
| `isAnimated(track, prop)` | 34 | בדיקת תנאי בוליאני או תקינות מצב (`isAnimated`). | 
| `sampleList(list, prop, t)` | 37 | דגימה וחישוב ערך בנקודה או בזמן נתון (`sampleList`). | 
| `sampleProp(track, prop, t)` | 57 | דגימה וחישוב ערך בנקודה או בזמן נתון (`sampleProp`). | 
| `newKey(t, easing = 'smooth')` | 64 | פונקציית עזר ולוגיקה ייעודית במודול (`newKey`). | 
| `findKey(track, t, eps = EPS_T)` | 68 | איתור וסינון הישות או המיקום המתאים ביותר (`findKey`). | 
| `setOwner(key, prop, owns)` | 78 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setOwner`). | 
| `resync(track)` | 84 | פונקציית עזר ולוגיקה ייעודית במודול (`resync`). | 
| `setStatic(track, prop, value)` | 107 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setStatic`). | 
| `setKey(track, prop, t, value, { clampEnd =...)` | 118 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setKey`). | 
| `pin(at)` | 122 | פונקציית עזר ולוגיקה ייעודית במודול (`pin`). | 
| `ownedKeyAt(track, prop, t, eps = EPS_T)` | 140 | פונקציית עזר ולוגיקה ייעודית במודול (`ownedKeyAt`). | 
| `anyKeyAt(track, t, eps = EPS_T)` | 145 | פונקציית עזר ולוגיקה ייעודית במודול (`anyKeyAt`). | 
| `removeKey(track, prop, t, eps = 0.03)` | 150 | איפוס, ביטול או הסרה של נתונים ישנים (`removeKey`). | 
| `clearProp(track, prop, value)` | 161 | איפוס, ביטול או הסרה של נתונים ישנים (`clearProp`). | 
| `moveProp(track, fromKey, prop, toT)` | 167 | פונקציית עזר ולוגיקה ייעודית במודול (`moveProp`). | 
| `migrateLegacyTrack(track)` | 186 | פונקציית עזר ולוגיקה ייעודית במודול (`migrateLegacyTrack`). | 
| `constant(prop)` | 196 | פונקציית עזר ולוגיקה ייעודית במודול (`constant`). | 

### `src/tools/studio/portraitRenderer.js`

**תפקיד הקובץ:** אולפן צילום פורטרטים (`createPortraitStudio`) עם שימוש חוזר ב-`WebGLRenderer` משותף.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `getSharedPortraitRenderer()` | 21 | שליפת נתונים או מצב נוכחי (`getSharedPortraitRenderer`). | 
| `createPortraitStudio(modelFactory, unitsData)` | 33 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`createPortraitStudio`). | 
| `render(unitId, faction, options = {})` | 45 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`render`. | 
| `dispose()` | 106 | ניקוי משאבים, מאזינים וזיכרון עבור `dispose`. | 
| `canvasToPngBytes(canvas)` | 113 | בדיקת תנאי בוליאני או תקינות מצב (`canvasToPngBytes`). | 
| `crc32(bytes)` | 123 | פונקציית עזר ולוגיקה ייעודית במודול (`crc32`). | 
| `makeZip(files)` | 138 | פונקציית עזר ולוגיקה ייעודית במודול (`makeZip`). | 
| `push(u8)` | 143 | פונקציית עזר ולוגיקה ייעודית במודול (`push`). | 
| `u16(v)` | 144 | פונקציית עזר ולוגיקה ייעודית במודול (`u16`). | 
| `u32(v)` | 145 | פונקציית עזר ולוגיקה ייעודית במודול (`u32`). | 
| `downloadBytes(bytes, filename, mime)` | 177 | פונקציית עזר ולוגיקה ייעודית במודול (`downloadBytes`). | 

### `src/tools/studio/sandboxArena.js`

**תפקיד הקובץ:** זירת בדיקה חיה בתוך מעבדת האנימציות לבחינת יחידות בתנועה ובלחימה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `constructor(scene, modelFactory, animationsCata...)` | 37 | בנאי המחלקה — מאתחל את השדות, המבנים והמצב ההתחלתי. | 
| `setData(unitsData)` | 76 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setData`). | 
| `_buildArenaFloor()` | 82 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildArenaFloor`). | 
| `setVisible(visible)` | 98 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setVisible`). | 
| `clearArena()` | 103 | איפוס, ביטול או הסרה של נתונים ישנים (`clearArena`). | 
| `dispose()` | 126 | ניקוי משאבים, מאזינים וזיכרון עבור `dispose`. | 
| `_createHpBar()` | 136 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_createHpBar`). | 
| `_statsFor(unitType)` | 148 | פונקציית עזר ולוגיקה ייעודית במודול (`_statsFor`). | 
| `setPaused(paused)` | 154 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setPaused`). | 
| `isPaused()` | 156 | בדיקת תנאי בוליאני או תקינות מצב (`isPaused`). | 
| `_blockLayout(count, spacing)` | 159 | פונקציית עזר ולוגיקה ייעודית במודול (`_blockLayout`). | 
| `ok(g)` | 183 | פונקציית עזר ולוגיקה ייעודית במודול (`ok`). | 
| `_setRingsVisible(on)` | 277 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setRingsVisible`). | 
| `groupAt(raycaster)` | 282 | פונקציית עזר ולוגיקה ייעודית במודול (`groupAt`). | 
| `getGroupAnchor(index)` | 301 | שליפת נתונים או מצב נוכחי (`getGroupAnchor`). | 
| `moveGroup(index, x, z)` | 304 | פונקציית עזר ולוגיקה ייעודית במודול (`moveGroup`). | 
| `getExtent()` | 324 | שליפת נתונים או מצב נוכחי (`getExtent`). | 
| `spawnMatchup(u1, f1, u2, f2, countPerSide = 1)` | 331 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`spawnMatchup`). | 
| `_onCombatantAnimEvent(attacker, evt)` | 339 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onCombatantAnimEvent`). | 
| `_spawnArrowProjectile(attacker, target, startWorldPos)` | 350 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`_spawnArrowProjectile`). | 
| `_applyDamage(attacker, defender, sparkPos)` | 357 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applyDamage`). | 
| `_separate()` | 385 | פונקציית עזר ולוגיקה ייעודית במודול (`_separate`). | 
| `_billboardBars(camera)` | 410 | פונקציית עזר ולוגיקה ייעודית במודול (`_billboardBars`). | 
| `update(dtSeconds, camera = null)` | 418 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`update`). | 
| `getDpsSummary()` | 493 | שליפת נתונים או מצב נוכחי (`getDpsSummary`). | 

### `src/tools/studio/skinUtils.js`

**תפקיד הקובץ:** ניהול פלטות צבעים וצביעת מודלים לפי צוות וגזע.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `getFactions(unitsData)` | 25 | שליפת נתונים או מצב נוכחי (`getFactions`). | 
| `getFactionLabel(unitsData, faction)` | 41 | שליפת נתונים או מצב נוכחי (`getFactionLabel`). | 
| `getFactionColors(unitsData, faction)` | 49 | שליפת נתונים או מצב נוכחי (`getFactionColors`). | 
| `isSharedUnitsFaction(unitsData, faction)` | 60 | בדיקת תנאי בוליאני או תקינות מצב (`isSharedUnitsFaction`). | 
| `ownMaterial(mesh)` | 71 | פונקציית עזר ולוגיקה ייעודית במודול (`ownMaterial`). | 
| `applySkinColors(group, unitDef, faction)` | 86 | הגדרה והחלה של ערכים או פקודות על האובייקט (`applySkinColors`). | 
| `disposeVisual(group)` | 119 | פונקציית עזר ולוגיקה ייעודית במודול (`disposeVisual`). | 

### `src/tools/studio/studioApp.js`

**תפקיד הקובץ:** אפליקציית מעבדת האנימציות התלת-ממדית (`StudioApp`) — עריכת שלדים, ציוד ואנימציות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `round4(v)` | 52 | פונקציית עזר ולוגיקה ייעודית במודול (`round4`). | 
| `round3v(a)` | 53 | פונקציית עזר ולוגיקה ייעודית במודול (`round3v`). | 
| `hasKeys(clip)` | 54 | בדיקת תנאי בוליאני או תקינות מצב (`hasKeys`). | 
| `_onSaveStatus(state, message)` | 215 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onSaveStatus`). | 
| `_renderStatus()` | 221 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderStatus`. | 
| `_toast(message, ms = 2200)` | 229 | פונקציית עזר ולוגיקה ייעודית במודול (`_toast`). | 
| `_factions()` | 241 | פונקציית עזר ולוגיקה ייעודית במודול (`_factions`). | 
| `_factionOptions(selected)` | 245 | פונקציית עזר ולוגיקה ייעודית במודול (`_factionOptions`). | 
| `_refreshFactionList()` | 251 | פונקציית עזר ולוגיקה ייעודית במודול (`_refreshFactionList`). | 
| `_unitsOfPeople(people)` | 259 | פונקציית עזר ולוגיקה ייעודית במודול (`_unitsOfPeople`). | 
| `_raceOf(id)` | 275 | פונקציית עזר ולוגיקה ייעודית במודול (`_raceOf`). | 
| `_refreshUnitList()` | 283 | פונקציית עזר ולוגיקה ייעודית במודול (`_refreshUnitList`). | 
| `_unitOptions(selected)` | 290 | פונקציית עזר ולוגיקה ייעודית במודול (`_unitOptions`). | 
| `_switchEntityCategory(cat)` | 300 | פונקציית עזר ולוגיקה ייעודית במודול (`_switchEntityCategory`). | 
| `_buildStudioDOM()` | 338 | בנייה ויצירה של אובייקט, גאומטריה או מבנה נתונים (`_buildStudioDOM`). | 
| `_initThreeScene()` | 465 | אתחול והקמת הרכיבים עבור `_initThreeScene`. | 
| `_base()` | 524 | פונקציית עזר ולוגיקה ייעודית במודול (`_base`). | 
| `_varIdx()` | 525 | פונקציית עזר ולוגיקה ייעודית במודול (`_varIdx`). | 
| `_scope()` | 526 | פונקציית עזר ולוגיקה ייעודית במודול (`_scope`). | 
| `_readName(base = this._base(), varIdx = this....)` | 527 | שליפת נתונים או מצב נוכחי (`_readName`). | 
| `_readKeyframeClip(base = this._base(), varIdx = this....)` | 530 | שליפת נתונים או מצב נוכחי (`_readKeyframeClip`). | 
| `_readProceduralClip(base = this._base())` | 534 | שליפת נתונים או מצב נוכחי (`_readProceduralClip`). | 
| `_previewKind()` | 540 | פונקציית עזר ולוגיקה ייעודית במודול (`_previewKind`). | 
| `_poseEditable()` | 548 | פונקציית עזר ולוגיקה ייעודית במודול (`_poseEditable`). | 
| `_getDefaultEventSocket(type)` | 552 | שליפת נתונים או מצב נוכחי (`_getDefaultEventSocket`). | 
| `kindOf(id)` | 555 | פונקציית עזר ולוגיקה ייעודית במודול (`kindOf`). | 
| `pick(test)` | 556 | איתור וסינון הישות או המיקום המתאים ביותר (`pick`). | 
| `_spawnStudioUnit()` | 563 | שיגור פקודה, יצירת יחידה או הפעלת פעולה בסימולציה (`_spawnStudioUnit`). | 
| `_syncClipSelection()` | 594 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncClipSelection`). | 
| `_syncGizmoTools()` | 647 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncGizmoTools`). | 
| `_openModal(html)` | 656 | פונקציית עזר ולוגיקה ייעודית במודול (`_openModal`). | 
| `_closeModal()` | 662 | פונקציית עזר ולוגיקה ייעודית במודול (`_closeModal`). | 
| `_modalOpen()` | 668 | פונקציית עזר ולוגיקה ייעודית במודול (`_modalOpen`). | 
| `_updateHealthBadge()` | 670 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateHealthBadge`). | 
| `_healthReportText(issues)` | 680 | פונקציית עזר ולוגיקה ייעודית במודול (`_healthReportText`). | 
| `_openHealth()` | 684 | פונקציית עזר ולוגיקה ייעודית במודול (`_openHealth`). | 
| `chip(lvl, label)` | 690 | פונקציית עזר ולוגיקה ייעודית במודול (`chip`). | 
| `_gotoIssue(goto)` | 718 | פונקציית עזר ולוגיקה ייעודית במודול (`_gotoIssue`). | 
| `qs(sel)` | 736 | פונקציית עזר ולוגיקה ייעודית במודול (`qs`). | 
| `_openPortraits()` | 743 | פונקציית עזר ולוגיקה ייעודית במודול (`_openPortraits`). | 
| `sel(id, label, options, value)` | 746 | פונקציית עזר ולוגיקה ייעודית במודול (`sel`). | 
| `q(s)` | 778 | פונקציית עזר ולוגיקה ייעודית במודול (`q`). | 
| `read()` | 781 | שליפת נתונים או מצב נוכחי (`read`). | 
| `shotOpts()` | 786 | פונקציית עזר ולוגיקה ייעודית במודול (`shotOpts`). | 
| `preview()` | 787 | פונקציית עזר ולוגיקה ייעודית במודול (`preview`). | 
| `_defaultArenaScene()` | 831 | פונקציית עזר ולוגיקה ייעודית במודול (`_defaultArenaScene`). | 
| `_renderArenaLists()` | 840 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderArenaLists`. | 
| `_arenaGroups()` | 864 | פונקציית עזר ולוגיקה ייעודית במודול (`_arenaGroups`). | 
| `_syncPlayLabel()` | 876 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncPlayLabel`). | 
| `_refreshWaitingArena()` | 882 | פונקציית עזר ולוגיקה ייעודית במודול (`_refreshWaitingArena`). | 
| `_bindArenaPanel()` | 886 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindArenaPanel`). | 
| `groupOf(row)` | 890 | פונקציית עזר ולוגיקה ייעודית במודול (`groupOf`). | 
| `hideLists(hide)` | 949 | פונקציית עזר ולוגיקה ייעודית במודול (`hideLists`). | 
| `quick(count)` | 955 | פונקציית עזר ולוגיקה ייעודית במודול (`quick`). | 
| `_bindArenaDrag()` | 971 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindArenaDrag`). | 
| `aim(e)` | 979 | פונקציית עזר ולוגיקה ייעודית במודול (`aim`). | 
| `ground()` | 984 | פונקציית עזר ולוגיקה ייעודית במודול (`ground`). | 

### `src/tools/studio/studioControlsAndLoop.js`

**תפקיד הקובץ:** לולאת הרינדור, הגיזמו, הקיצורים וההיסטוריה (`Undo/Redo`) במעבדת האנימציות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `round4(v)` | 56 | פונקציית עזר ולוגיקה ייעודית במודול (`round4`). | 
| `round3v(a)` | 57 | פונקציית עזר ולוגיקה ייעודית במודול (`round3v`). | 
| `hasKeys(clip)` | 58 | בדיקת תנאי בוליאני או תקינות מצב (`hasKeys`). | 
| `_initTimelineEditor()` | 74 | אתחול והקמת הרכיבים עבור `_initTimelineEditor`. | 
| `data()` | 76 | פונקציית עזר ולוגיקה ייעודית במודול (`data`). | 
| `_keyGuard()` | 197 | פונקציית עזר ולוגיקה ייעודית במודול (`_keyGuard`). | 
| `_beginEdit(tag)` | 206 | פונקציית עזר ולוגיקה ייעודית במודול (`_beginEdit`). | 
| `_stepHistory(from, to, label)` | 217 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`_stepHistory`). | 
| `_undo()` | 229 | פונקציית עזר ולוגיקה ייעודית במודול (`_undo`). | 
| `_redo()` | 230 | פונקציית עזר ולוגיקה ייעודית במודול (`_redo`). | 
| `_onRestartAnim(base)` | 232 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onRestartAnim`). | 
| `_renderModeHelp()` | 243 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderModeHelp`. | 
| `_setEditMode(mode)` | 255 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setEditMode`). | 
| `qs(s)` | 263 | פונקציית עזר ולוגיקה ייעודית במודול (`qs`). | 
| `_applyBottomPanel()` | 277 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applyBottomPanel`). | 
| `_showView(view)` | 284 | פונקציית עזר ולוגיקה ייעודית במודול (`_showView`). | 
| `_rebindData()` | 311 | פונקציית עזר ולוגיקה ייעודית במודול (`_rebindData`). | 
| `_bindSidebarControls()` | 329 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindSidebarControls`). | 
| `handSide()` | 367 | פונקציית עזר ולוגיקה ייעודית במודול (`handSide`). | 
| `_resetSelectedJoint()` | 515 | פונקציית עזר ולוגיקה ייעודית במודול (`_resetSelectedJoint`). | 
| `_bindViewportPick()` | 538 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindViewportPick`). | 
| `_bindKeyboard()` | 588 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindKeyboard`). | 
| `_tickStudio(dt)` | 645 | פונקציית עזר ולוגיקה ייעודית במודול (`_tickStudio`). | 
| `_startLoop()` | 681 | הפעלת תהליך או לולאת ריצה ב-`_startLoop`. | 
| `frame(now)` | 684 | פונקציית עזר ולוגיקה ייעודית במודול (`frame`). | 
| `destroy()` | 744 | ניקוי משאבים, מאזינים וזיכרון עבור `destroy`. | 

### `src/tools/studio/studioGearAndPose.js`

**תפקיד הקובץ:** ניהול ציוד, אחיזת נשקים, צבעים ופוזות במעבדת האנימציות.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `round4(v)` | 56 | פונקציית עזר ולוגיקה ייעודית במודול (`round4`). | 
| `round3v(a)` | 57 | פונקציית עזר ולוגיקה ייעודית במודול (`round3v`). | 
| `hasKeys(clip)` | 58 | בדיקת תנאי בוליאני או תקינות מצב (`hasKeys`). | 
| `_renderRigPanel()` | 74 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderRigPanel`. | 
| `chip(n)` | 78 | פונקציית עזר ולוגיקה ייעודית במודול (`chip`). | 
| `_eq(create = false)` | 96 | פונקציית עזר ולוגיקה ייעודית במודול (`_eq`). | 
| `_setLoadout(id)` | 106 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setLoadout`). | 
| `_newLoadout()` | 114 | פונקציית עזר ולוגיקה ייעודית במודול (`_newLoadout`). | 
| `_deleteLoadout()` | 147 | פונקציית עזר ולוגיקה ייעודית במודול (`_deleteLoadout`). | 
| `_restowAll()` | 162 | פונקציית עזר ולוגיקה ייעודית במודול (`_restowAll`). | 
| `_autoStow()` | 168 | פונקציית עזר ולוגיקה ייעודית במודול (`_autoStow`). | 
| `_actionList()` | 181 | פונקציית עזר ולוגיקה ייעודית במודול (`_actionList`). | 
| `_isStandaloneMountUnit()` | 222 | פונקציית עזר ולוגיקה ייעודית במודול (`_isStandaloneMountUnit`). | 
| `_slotOf(joint)` | 228 | פונקציית עזר ולוגיקה ייעודית במודול (`_slotOf`). | 
| `_prefabSlot(def)` | 250 | פונקציית עזר ולוגיקה ייעודית במודול (`_prefabSlot`). | 
| `_hasBowEquipped()` | 252 | פונקציית עזר ולוגיקה ייעודית במודול (`_hasBowEquipped`). | 
| `_ensureArrowConfig()` | 262 | פונקציית עזר ולוגיקה ייעודית במודול (`_ensureArrowConfig`). | 
| `_refreshStudioArrowPreview()` | 275 | פונקציית עזר ולוגיקה ייעודית במודול (`_refreshStudioArrowPreview`). | 
| `_pairedCounterpartJoint(joint)` | 280 | פונקציית עזר ולוגיקה ייעודית במודול (`_pairedCounterpartJoint`). | 
| `_pairedCounterpartPrefab(prefabId)` | 290 | פונקציית עזר ולוגיקה ייעודית במודול (`_pairedCounterpartPrefab`). | 
| `_friendlyPrefabLabel(id, pf)` | 297 | פונקציית עזר ולוגיקה ייעודית במודול (`_friendlyPrefabLabel`). | 
| `_renderGearPanel()` | 341 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderGearPanel`. | 
| `sideSuffix(name)` | 406 | פונקציית עזר ולוגיקה ייעודית במודול (`sideSuffix`). | 
| `items(slot, joint)` | 408 | פונקציית עזר ולוגיקה ייעודית במודול (`items`). | 
| `rowLabelFor(joint, slot)` | 461 | פונקציית עזר ולוגיקה ייעודית במודול (`rowLabelFor`). | 
| `tab(id, label)` | 558 | פונקציית עזר ולוגיקה ייעודית במודול (`tab`). | 
| `_equipSlot(joint, prefabId)` | 576 | פונקציית עזר ולוגיקה ייעודית במודול (`_equipSlot`). | 
| `_resetJointsToRest()` | 626 | פונקציית עזר ולוגיקה ייעודית במודול (`_resetJointsToRest`). | 
| `_applyPoseAt(t)` | 637 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applyPoseAt`). | 
| `_prepareEdit()` | 660 | פונקציית עזר ולוגיקה ייעודית במודול (`_prepareEdit`). | 
| `_handSide()` | 677 | פונקציית עזר ולוגיקה ייעודית במודול (`_handSide`). | 
| `_setCurl(side, which, t)` | 683 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setCurl`). | 
| `_curlOf(side, which)` | 702 | פונקציית עזר ולוגיקה ייעודית במודול (`_curlOf`). | 
| `_syncHandControls()` | 713 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncHandControls`). | 
| `_getJointPose(jointName)` | 727 | שליפת נתונים או מצב נוכחי (`_getJointPose`). | 
| `_jointRules(name)` | 739 | פונקציית עזר ולוגיקה ייעודית במודול (`_jointRules`). | 
| `find(nodes)` | 740 | איתור וסינון הישות או המיקום המתאים ביותר (`find`). | 
| `_enforceJointRules(name, obj)` | 753 | פונקציית עזר ולוגיקה ייעודית במודול (`_enforceJointRules`). | 
| `_onPoseEdited()` | 778 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onPoseEdited`). | 
| `_commitPose(joint)` | 809 | פונקציית עזר ולוגיקה ייעודית במודול (`_commitPose`). | 
| `_writeRestPose(jointName, obj)` | 841 | פונקציית עזר ולוגיקה ייעודית במודול (`_writeRestPose`). | 
| `walk(nodes)` | 850 | פונקציית עזר ולוגיקה ייעודית במודול (`walk`). | 
| `_updateKeyContext()` | 862 | עדכון מצב הרכיב בצעד הסימולציה או הפריים הנוכחי (`_updateKeyContext`). | 
| `_onProceduralChange(key, value)` | 870 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onProceduralChange`). | 
| `_jointMeshes(jointName)` | 927 | פונקציית עזר ולוגיקה ייעודית במודול (`_jointMeshes`). | 
| `_jointColorHex(jointName)` | 943 | פונקציית עזר ולוגיקה ייעודית במודול (`_jointColorHex`). | 
| `_applyColorPreview(hex)` | 948 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applyColorPreview`). | 
| `_restoreColorPreview(onlyIfJoint = null)` | 959 | פונקציית עזר ולוגיקה ייעודית במודול (`_restoreColorPreview`). | 
| `_saveColorOverride(hex, scope)` | 968 | פונקציית עזר ולוגיקה ייעודית במודול (`_saveColorOverride`). | 
| `overridesOf(u, f)` | 975 | פונקציית עזר ולוגיקה ייעודית במודול (`overridesOf`). | 
| `setColor(u, f)` | 990 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setColor`). | 

### `src/tools/studio/studioStateManager.js`

**תפקיד הקובץ:** מודול ליבה בפרויקט.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `deepClone(o)` | 18 | פונקציית עזר ולוגיקה ייעודית במודול (`deepClone`). | 
| `hashString(str)` | 20 | בדיקת תנאי בוליאני או תקינות מצב (`hashString`). | 
| `_freshDefaults()` | 50 | פונקציית עזר ולוגיקה ייעודית במודול (`_freshDefaults`). | 
| `_mergeMissingDefaults(data)` | 57 | פונקציית עזר ולוגיקה ייעודית במודול (`_mergeMissingDefaults`). | 
| `addMissing(target, source, label)` | 59 | פונקציית עזר ולוגיקה ייעודית במודול (`addMissing`). | 
| `_mergeMissingFields(data)` | 91 | פונקציית עזר ולוגיקה ייעודית במודול (`_mergeMissingFields`). | 
| `findNode(tree, name, parent = null)` | 99 | איתור וסינון הישות או המיקום המתאים ביותר (`findNode`). | 
| `addStow(dTree, uTree, dParentName)` | 107 | פונקציית עזר ולוגיקה ייעודית במודול (`addStow`). | 
| `_loadDraft()` | 134 | פונקציית עזר ולוגיקה ייעודית במודול (`_loadDraft`). | 
| `_emit(state, message = '')` | 189 | פונקציית עזר ולוגיקה ייעודית במודול (`_emit`). | 
| `saveDraft()` | 194 | פונקציית עזר ולוגיקה ייעודית במודול (`saveDraft`). | 
| `scheduleSave(delayMs = SAVE_DELAY_MS)` | 217 | פונקציית עזר ולוגיקה ייעודית במודול (`scheduleSave`). | 
| `flush()` | 225 | פונקציית עזר ולוגיקה ייעודית במודול (`flush`). | 
| `resetToDefault()` | 231 | איפוס, ביטול או הסרה של נתונים ישנים (`resetToDefault`). | 
| `resetClip(unitId, faction, base, scope)` | 248 | איפוס, ביטול או הסרה של נתונים ישנים (`resetClip`). | 
| `exportCustomJson(filename = 'units_export.json')` | 258 | פונקציית עזר ולוגיקה ייעודית במודול (`exportCustomJson`). | 
| `importJsonText(text)` | 270 | פונקציית עזר ולוגיקה ייעודית במודול (`importJsonText`). | 
| `snapshot()` | 287 | פונקציית עזר ולוגיקה ייעודית במודול (`snapshot`). | 
| `restoreSnapshot(text)` | 291 | פונקציית עזר ולוגיקה ייעודית במודול (`restoreSnapshot`). | 
| `destroy()` | 296 | ניקוי משאבים, מאזינים וזיכרון עבור `destroy`. | 

### `src/tools/studio/timelineEditor.js`

**תפקיד הקובץ:** עורך ציר הזמן (`TimelineEditor`) לעריכת Keyframes ואירועי אנימציה.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `round2(t)` | 46 | פונקציית עזר ולוגיקה ייעודית במודול (`round2`). | 
| `round3(t)` | 47 | פונקציית עזר ולוגיקה ייעודית במודול (`round3`). | 
| `clamp01(t)` | 48 | פונקציית עזר ולוגיקה ייעודית במודול (`clamp01`). | 
| `byTime(a, b)` | 49 | פונקציית עזר ולוגיקה ייעודית במודול (`byTime`). | 
| `clone(o)` | 50 | פונקציית עזר ולוגיקה ייעודית במודול (`clone`). | 
| `leftCss(t)` | 51 | פונקציית עזר ולוגיקה ייעודית במודול (`leftCss`). | 
| `isZero3(v)` | 52 | בדיקת תנאי בוליאני או תקינות מצב (`isZero3`). | 
| `kid(joint, prop, t)` | 53 | פונקציית עזר ולוגיקה ייעודית במודול (`kid`). | 
| `SVG(inner, extra = '')` | 70 | פונקציית עזר ולוגיקה ייעודית במודול (`SVG`). | 
| `refreshClipList()` | 123 | פונקציית עזר ולוגיקה ייעודית במודול (`refreshClipList`). | 
| `canKeyframe()` | 134 | בדיקת תנאי בוליאני או תקינות מצב (`canKeyframe`). | 
| `getClipName()` | 136 | שליפת נתונים או מצב נוכחי (`getClipName`). | 
| `getResolvedClipName()` | 141 | שליפת נתונים או מצב נוכחי (`getResolvedClipName`). | 
| `getReadClip()` | 143 | שליפת נתונים או מצב נוכחי (`getReadClip`). | 
| `getWriteClip()` | 145 | שליפת נתונים או מצב נוכחי (`getWriteClip`). | 
| `getDuration()` | 147 | שליפת נתונים או מצב נוכחי (`getDuration`). | 
| `_track(joint)` | 153 | פונקציית עזר ולוגיקה ייעודית במודול (`_track`). | 
| `_writeTrack(joint)` | 155 | פונקציית עזר ולוגיקה ייעודית במודול (`_writeTrack`). | 
| `_cleanup(joint)` | 164 | פונקציית עזר ולוגיקה ייעודית במודול (`_cleanup`). | 
| `keyframeAt(jointName, t = this.scrubNormTime)` | 174 | פונקציית עזר ולוגיקה ייעודית במודול (`keyframeAt`). | 
| `isPropAnimated(joint, prop)` | 178 | בדיקת תנאי בוליאני או תקינות מצב (`isPropAnimated`). | 
| `getPropValue(joint, prop, t = this.scrubNormTime)` | 180 | שליפת נתונים או מצב נוכחי (`getPropValue`). | 
| `_before(tag)` | 182 | פונקציית עזר ולוגיקה ייעודית במודול (`_before`). | 
| `_modified()` | 184 | פונקציית עזר ולוגיקה ייעודית במודול (`_modified`). | 
| `clearSelection()` | 188 | איפוס, ביטול או הסרה של נתונים ישנים (`clearSelection`). | 
| `_selectedItems()` | 196 | פונקציית עזר ולוגיקה ייעודית במודול (`_selectedItems`). | 
| `_applySelectionClasses()` | 206 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_applySelectionClasses`). | 
| `setSelectedJoint(jointName)` | 219 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setSelectedJoint`). | 
| `refresh()` | 229 | פונקציית עזר ולוגיקה ייעודית במודול (`refresh`). | 
| `setPlaying(playing)` | 235 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setPlaying`). | 
| `togglePlay()` | 242 | פונקציית עזר ולוגיקה ייעודית במודול (`togglePlay`). | 
| `forcePause()` | 244 | פונקציית עזר ולוגיקה ייעודית במודול (`forcePause`). | 
| `seek(t)` | 247 | פונקציית עזר ולוגיקה ייעודית במודול (`seek`). | 
| `step(direction, big = false)` | 254 | ביצוע צעד חישוב דטרמיניסטי של המערכת (`step`). | 
| `goToStart()` | 260 | פונקציית עזר ולוגיקה ייעודית במודול (`goToStart`). | 
| `goToEnd()` | 262 | פונקציית עזר ולוגיקה ייעודית במודול (`goToEnd`). | 
| `syncPlayhead(normT)` | 265 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`syncPlayhead`). | 
| `editProp(joint, prop, value)` | 277 | פונקציית עזר ולוגיקה ייעודית במודול (`editProp`). | 
| `toggleProp(joint, prop)` | 291 | פונקציית עזר ולוגיקה ייעודית במודול (`toggleProp`). | 
| `closeLoop()` | 319 | פונקציית עזר ולוגיקה ייעודית במודול (`closeLoop`). | 
| `_mirrorOne(src, dst, clip)` | 350 | פונקציית עזר ולוגיקה ייעודית במודול (`_mirrorOne`). | 
| `mirror(scope = 'joint')` | 362 | פונקציית עזר ולוגיקה ייעודית במודול (`mirror`). | 
| `sideOf(n)` | 367 | פונקציית עזר ולוגיקה ייעודית במודול (`sideOf`). | 
| `setZoom(z, anchorFrac = null)` | 385 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setZoom`). | 
| `deleteSelection()` | 397 | איפוס, ביטול או הסרה של נתונים ישנים (`deleteSelection`). | 
| `setEasingAtPlayhead(value)` | 445 | הגדרה והחלה של ערכים או פקודות על האובייקט (`setEasingAtPlayhead`). | 
| `copyAtPlayhead()` | 463 | פונקציית עזר ולוגיקה ייעודית במודול (`copyAtPlayhead`). | 
| `pasteAtPlayhead()` | 483 | פונקציית עזר ולוגיקה ייעודית במודול (`pasteAtPlayhead`). | 
| `addEvent(type)` | 512 | פונקציית עזר ולוגיקה ייעודית במודול (`addEvent`). | 
| `destroy()` | 546 | ניקוי משאבים, מאזינים וזיכרון עבור `destroy`. | 

### `src/tools/studio/timelineSheetAndPointer.js`

**תפקיד הקובץ:** גליון הערוצים ואינטראקציית גרירת Keyframes בעורך ציר הזמן.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `round2(t)` | 50 | פונקציית עזר ולוגיקה ייעודית במודול (`round2`). | 
| `round3(t)` | 51 | פונקציית עזר ולוגיקה ייעודית במודול (`round3`). | 
| `clamp01(t)` | 52 | פונקציית עזר ולוגיקה ייעודית במודול (`clamp01`). | 
| `byTime(a, b)` | 53 | פונקציית עזר ולוגיקה ייעודית במודול (`byTime`). | 
| `clone(o)` | 54 | פונקציית עזר ולוגיקה ייעודית במודול (`clone`). | 
| `leftCss(t)` | 55 | פונקציית עזר ולוגיקה ייעודית במודול (`leftCss`). | 
| `isZero3(v)` | 56 | בדיקת תנאי בוליאני או תקינות מצב (`isZero3`). | 
| `kid(joint, prop, t)` | 57 | פונקציית עזר ולוגיקה ייעודית במודול (`kid`). | 
| `SVG(inner, extra = '')` | 74 | פונקציית עזר ולוגיקה ייעודית במודול (`SVG`). | 
| `_renderUI()` | 86 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderUI`. | 
| `q(sel)` | 171 | פונקציית עזר ולוגיקה ייעודית במודול (`q`). | 
| `_syncPlayButton()` | 191 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncPlayButton`). | 
| `_bindUIEvents()` | 195 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_bindUIEvents`). | 
| `showBase(base, scope = null)` | 291 | פונקציית עזר ולוגיקה ייעודית במודול (`showBase`). | 
| `_afterClipChange()` | 299 | פונקציית עזר ולוגיקה ייעודית במודול (`_afterClipChange`). | 
| `_setScope(scope)` | 309 | הגדרה והחלה של ערכים או פקודות על האובייקט (`_setScope`). | 
| `_onDurationChange(e)` | 319 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onDurationChange`). | 
| `_eventsForDisplay()` | 348 | פונקציית עזר ולוגיקה ייעודית במודול (`_eventsForDisplay`). | 
| `_parents()` | 354 | פונקציית עזר ולוגיקה ייעודית במודול (`_parents`). | 
| `_reveal(joint)` | 363 | פונקציית עזר ולוגיקה ייעודית במודול (`_reveal`). | 
| `_ancestors(joint, par)` | 369 | פונקציית עזר ולוגיקה ייעודית במודול (`_ancestors`). | 
| `_visibleJoints()` | 377 | פונקציית עזר ולוגיקה ייעודית במודול (`_visibleJoints`). | 
| `animated(j)` | 383 | פונקציית עזר ולוגיקה ייעודית במודול (`animated`). | 
| `hasAnimatedBelow(j)` | 384 | בדיקת תנאי בוליאני או תקינות מצב (`hasAnimatedBelow`). | 
| `walk(n, depth)` | 387 | פונקציית עזר ולוגיקה ייעודית במודול (`walk`). | 
| `_rulerHtml()` | 397 | פונקציית עזר ולוגיקה ייעודית במודול (`_rulerHtml`). | 
| `_diamond(joint, prop, track, key)` | 425 | פונקציית עזר ולוגיקה ייעודית במודול (`_diamond`). | 
| `_renderSheet()` | 433 | רינדור וציור רכיבי התצוגה או ה-DOM ב-`_renderSheet`. | 
| `_syncPlayheadUI()` | 508 | סנכרון מצב בין הסימולציה, המבנה והתצוגה (`_syncPlayheadUI`). | 
| `_xToT(clientX)` | 524 | פונקציית עזר ולוגיקה ייעודית במודול (`_xToT`). | 
| `_selectRow(joint, prop)` | 532 | פונקציית עזר ולוגיקה ייעודית במודול (`_selectRow`). | 
| `_onRowsClick(e)` | 540 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onRowsClick`). | 
| `_onRowsPointerDown(e)` | 569 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onRowsPointerDown`). | 
| `_marqueeRect(d, e)` | 631 | פונקציית עזר ולוגיקה ייעודית במודול (`_marqueeRect`). | 
| `_drawMarquee(r)` | 638 | פונקציית עזר ולוגיקה ייעודית במודול (`_drawMarquee`). | 
| `_removeMarquee()` | 647 | איפוס, ביטול או הסרה של נתונים ישנים (`_removeMarquee`). | 
| `_onPointerMove(e)` | 652 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onPointerMove`). | 
| `_moveGroup(d, rawDelta)` | 712 | פונקציית עזר ולוגיקה ייעודית במודול (`_moveGroup`). | 
| `_onPointerUp()` | 733 | טיפול באירועי קלט, עכבר, מקלדת או הודעות (`_onPointerUp`). | 

### `src/tools/studio/weaponRules.js`

**תפקיד הקובץ:** חוקי התאמת נשקים וציוד לחריצי הידיים והגוף.

| פונקציה / מתודה | שורה | מה היא עושה | 
| ----- | ----- | ----- | 
| `rulesOf(data)` | 46 | פונקציית עזר ולוגיקה ייעודית במודול (`rulesOf`). | 
| `weaponTypeOf(prefabDef)` | 48 | פונקציית עזר ולוגיקה ייעודית במודול (`weaponTypeOf`). | 
| `isTwoHanded(prefabDef)` | 49 | בדיקת תנאי בוליאני או תקינות מצב (`isTwoHanded`). | 
| `loadoutsOf(unitDef)` | 58 | פונקציית עזר ולוגיקה ייעודית במודול (`loadoutsOf`). | 
| `equipmentOf(unitDef, loadoutId)` | 63 | פונקציית עזר ולוגיקה ייעודית במודול (`equipmentOf`). | 
| `asLoadout(unitDef, loadoutId)` | 65 | פונקציית עזר ולוגיקה ייעודית במודול (`asLoadout`). | 
| `otherHand(socket)` | 67 | פונקציית עזר ולוגיקה ייעודית במודול (`otherHand`). | 
| `heldItems(data, unitDef)` | 70 | פונקציית עזר ולוגיקה ייעודית במודול (`heldItems`). | 
| `lockedHand(data, unitDef)` | 81 | פונקציית עזר ולוגיקה ייעודית במודול (`lockedHand`). | 
| `isDualWield(data, unitDef)` | 87 | בדיקת תנאי בוליאני או תקינות מצב (`isDualWield`). | 
| `grantedActions(data, unitDef, actionOrder = [], { ...)` | 96 | פונקציית עזר ולוגיקה ייעודית במודול (`grantedActions`). | 
| `give(action, reason)` | 99 | פונקציית עזר ולוגיקה ייעודית במודול (`give`). | 
| `bodyHasMesh(unitDef, re)` | 141 | פונקציית עזר ולוגיקה ייעודית במודול (`bodyHasMesh`). | 
| `walk(tree)` | 142 | פונקציית עזר ולוגיקה ייעודית במודול (`walk`). | 
| `restow(data, unitDef)` | 146 | פונקציית עזר ולוגיקה ייעודית במודול (`restow`). | 
| `autoStow(data, unitDef, loadoutId)` | 195 | פונקציית עזר ולוגיקה ייעודית במודול (`autoStow`). | 

## 8. תיקיות הטסטים האוטומטיים (`tests/`)

| תיקייה וקובץ | תפקיד ומה נבדק | 
| ----- | ----- | 
| `tests/run_all_tests.mjs` | מריץ הראשי שמפעיל את כל 7 תיקיות הטסטים ומדפיס דו"ח אימות מלא. | 
| `tests/core/fx_and_buses.test.mjs` | בדיקת מתמטיקת נקודה-קבועה (`fxSin`, `fxCos`, `fxAtan2`, `fxHypot`, `mulDiv`), `fxRandomRange`, `CommandBus` ו-`EventBus`. | 
| `tests/movement/walking_and_formations.test.mjs` | בדיקת הליכה, פניות 180 מעלות ללא הצלבת שורות (`_forceNearestSlotMatch`), אפס החלקה ב-`IDLE`, סנכרון קבוצות `Alt`, ואיפוס כפתור הריצה בעצירה תוך שמירה על הדלקה במנוחה. | 
| `tests/combat/melee_ranged_and_heroes.test.mjs` | בדיקת קרב קפא"פ וירי, סנכרון זמן התייצרות גיבור (`trainTimeSec`) מהיכל הגיבורים, והטלת לחשים (`fireball`). | 
| `tests/economy/popcap_and_gathering.test.mjs` | בדיקת איסוף משאבים, בנייה, ועצירת ייצור דטרמיניסטית ב-99% (`HOLD (Full Pop)`) שמשתחררת אוטומטית עם השלמת בית (`house`). | 
| `tests/ai/fairplay_and_progression.test.mjs` | בדיקת ה-AI החכם לאורך אלפי טיקים — בידוד ערפל מלחמה, בניית בתים ומחנות צבא ללא תקיעת פועלים, וגיוס יחידות קאונטר. | 
| `tests/render/animations_and_batching.test.mjs` | בדיקת `ModelFactory`, `Animator3D`, `UnitRenderer`, שימור `locomotionAnim` מבוסס Keyframes ב-`sanitizeUnitsData`, וגובה מד החיים (`3.75m`) של גיבור רכוב. | 
| `tests/ui/picker_and_cursors.test.mjs` | בדיקת `WorldPicker` (קופסת פגיעה תלת-ממדית מכפות הרגליים לראש מכל זוויות המצלמה) וכיול נקודת הלחיצה (`CURSOR_HOTSPOTS`). | 
| `tests/run_comparison.mjs` & `tests/full_regression_suite.mjs` | בדיקות השוואת רגרסיה מול הפרויקט המקורי. | 

## 9. תוספות אחרונות: בליסטרה (`ballista`), תפריט קודים `/` בקונסול, סנכרון מעבדות וטסטים למקרי קצה

### א. יחידת מצור חדשה — בליסטרה (`ballista`, `unitTypeIdx: 6`)

* **`src/sim/gameState.js`**:

  * `UnitTypeIndex.ballista = 6` ו-`IndexToUnitType[6] = 'ballista'`.

  * `spawnCompany(opts)` — מתודה דטרמיניסטית ליצירת פלוגה חדשה ויחידותיה בנקודה במפה, כולל חישוב משבצות מבנה ועדכון אוכלוסייה.

* **`src/data/buildings.json` & `src/sim/systems/productionAndRallySystem.js`**:

  * במבנה `siege_works` האפשרות `ballista` מגייסת סוללת בליסטראות אמיתית (`unitType: "ballista"`, `count: 3`, `260 HP`, מהירות `148`, עלות אוכלוסייה `3`).

* **`src/sim/systems/movementSystem.js` (`UnitPhysicsProfile[6]`)**:

  * טווח ירי ארטילרי של **155 מטרים** (`attackRangeFx: 158720`), נזק בסיס **95**, מכפיל נזק מצור למבנים **3.5x** (`vsBuildingPermille: 3500`), מסה `380`, רדיוס `1150`.

* **`src/sim/systems/ballisticAndDamageSystem.js` & `src/sim/systems/unitCombatStepper.js`**:

  * קליעי בליסטרה (`isBallista: true`) עוקפים את הגנת החיצים של מבנים (`arrowProtectionPermille`), אינם ניתנים לחסימה על ידי מגן, מפילים חיילים בפגיעה ישירה וגורמים לנזק רסס היקפי (`2.4m`).

* **`src/data/visuals/units.json` & `src/tools/studio/studioApp.js`**:

  * מודל תלת-ממדי מלא של בליסטרה על 4 גלגלי עץ וברזל (`pelvis`, `leg_L`, `leg_R`, `shin_L`, `shin_R`), עריסת צידוד ומסילה (`torso`), זרועות פיתול וכבלים (`arm_L`, `arm_R`, `forearm_L`, `forearm_R`), כננת מתיחה (`head`) וחץ מצור כבד (`ballista_crossbow` על `weapon_socket_R`), כולל אנימציות סיבוב גלגלים בהליכה, מתיחה ורתע בירי, פגיעה והתפרקות.

### ב. פתיחת כל הקודים בלחיצה על `/` בקונסול (`src/ui/hud/devConsole.js`)

* `DEV_CONSOLE_COMMANDS` — קטלוג כל 14 קודי הקונסול הזמינים (`/c` או `fow`, `/q`, `/lv`, `/ballista`, `/d`, `/ai adaptive`, `/ai hard`, `/ai normal`, `/ai easy`, `/ai off`, `/laststand`, `/panic`, `/win`, `/lose`).

* `open(showList, initialValue)` — פתיחת הקונסול (בלחיצה על `/` נפתח ישירות עם רשימת כל הקודים האינטראקטיבית).

* `_getFilterQuery()` — סינון חי של רשימת הקודים בזמן הקלדה (עם או בלי קידומת `/`).

* `_renderCommandList()` — רינדור תפריט הקודים האינטראקטיבי עם תמיכה בניווט מקלדת (`ArrowUp` / `ArrowDown` / `Enter`) ולחיצת עכבר להרצה מיידית.

* `executeCode(rawCode)` — הרצת קוד קונסול (כולל הסרת `/` תחילית) וסגירת הקונסול.

### ג. סנכרון 100% בין מעבדת האנימציה (`/studio`), היכל הגיבורים (`/heroes`) ושדה הקרב (`/`)

* **`src/tools/heroes/heroStateManager.js`**:

  * `loadActiveUnitsVisualsData(baseUnitsData)` — טעינת טיוטת מעבדת האנימציה מ-`localStorage` ומיזוג אוטומטי של כל יחידה, פריפאב או אנימציה חדשים מ-`units.json`.

  * `syncFromStudioView()` ו-`buildCombinedVisualsData()` — שמירת דגל `userModifiedInStudio = true` על כל אנימציה שנערכה במעבדה וסנכרון דו-כיווני מלא בין המעבדות למשחק.

## 9. מעבדת הלוחמים והבתים (`src/tools/units_buildings/` ו-`src/data/unitStats.json` / `buildingVisuals.json`)

| קובץ | תפקיד ופונקציות מרכזיות | 
| ----- | ----- | 
| `src/data/unitStats.json` | קובץ הגדרות מלא לכל הלוחמים והפועלים: זהות, דמות בסיס, רכיבה, פרמטרי קרב ותנועה, עלויות, מערכים מותרים (`allowedFormations`), וחוקי מערכים לפי נשק (`formationRules`), כולל הגדרות חציבה לפי סוג משאב וכניסה מהדלת לפועלים (`workerGathering`). | 
| `src/data/buildingVisuals.json` | קובץ אנימציות ה-Keyframe של המבנים עבור מעבדת האנימציות (`building_idle`, `building_build_construct`, `building_recruit_spawn`, `building_damage_stage_1`, `building_damage_stage_2`, `building_collapse_destroy`). | 
| `src/tools/units_buildings/unitsBuildingsStateManager.js` | `UnitsBuildingsStateManager`, `computeEligibleFormationsForUnit`, `syncLiveConfigObjectsInMemory` — ניהול וסנכרון דו-כיווני בזמן אמת בין מעבדת הלוחמים והבתים, מעבדת האנימציות (`StudioApp`), והסימולציה במשחק (`MovementSystem`, `ConstructionSystem`, `ProductionAndRallySystem`, `BuildingCombatSystem`, `EconomySystem`). | 
| `src/tools/units_buildings/buildingStudioAdapter.js` | `buildBuildingsStudioViewData`, `BUILDING_STUDIO_CLIPS` — ממיר כל מבנה מ-`buildings.json` להיררכיית תלת-ממד מפרקית (`pelvis`, `torso`, `head`, `arm_L` שער שמאל, `arm_R` שער ימין) עבור מעבדת האנימציות, כולל הצגת חרכי ירי (`arrow_slit`) אך ורק כש-`maxGarrison > 0`. | 
| `src/tools/units_buildings/unitsTabRenderer.js` | `renderUnitsLeftListHtml`, `renderUnitRightInspectorHtml` — ממשק לשונית **לוחמים**: יצירת לוחם חדש מדמות בסיס, הרכבת נשקים ושריון (סט 1 וסט 2), הפעלה/כיבוי של מצבי מערך לפי נשק ורכיבה, כל פרמטרי הקרב/משקל/מהירות/עלויות, וזמני חציבה לפי משאב + כניסה מהדלת לפועלים. | 
| `src/tools/units_buildings/buildingsTabRenderer.js` | `renderBuildingRightInspectorHtml`, `renderBuildingsLeftListHtml` — ממשק לשונית **בתים**: זמן בנייה, עלויות, רמה מקסימלית (`maxLevel`), האצת גיוס לכל רמה (`trainSpeedBonusPctPerLevel`), פתיחת יחידות לפי רמה (`unlockLevel`), רמת הופעת מגדל שמירה (`watchtowerLevel`), מגדל שמירה אוניברסלי משותף לכל הבתים (`sharedBuildingWatchtower`), מגדל שמירה רגיל, מגדל בליסטרה (`mountedBallistaUnitId`, חרכי ירי מותנים ב-`maxGarrison`), בית מרפא ובית דגלים. | 
| `src/tools/units_buildings/unitsBuildingsLabApp.js` | `UnitsBuildingsLabApp` — אפליקציית המעבדה המלאה עם תצוגת תלת-ממד חיה ללוחמים ולמבנים (כולל בדיקת פתיחת שער, מגדל שמירה ופיגומים) ומעבר בלחיצה אחת למעבדת האנימציות. | 


### Central Combat Capabilities & E2E Lab-to-Worker Sync
- `src/sim/combatCapabilitiesRegistry.js`: Central registry mapping active weapon sets (`Set 1` / `Set 2`) and mounts to allowed formations (`square`, `shieldWall`, `spearWall`, `pikePhalanx`, `wedge`, `skirmishCircle`) and combat modes (`fireAtWill`, `holdGround`, `skirmishKite`, `chargeImpact`) across the Units Lab, HUD (`UnitTacticalOrb`, `FormationPreview3D`), Web Worker (`GameState`, `Company`, `MovementSystem`, `ProductionAndRallySystem`), and `UnitRenderer`.
