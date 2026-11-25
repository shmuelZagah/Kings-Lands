/**
 * Shipped game data, assembled from the per-race layout (src/data/{races,bases,shared}).
 *
 * These are the SAME mutable objects the game has always used as "defaults" (the old monolithic JSON modules).
 * Only dataRegistry.js (and the sim's single apply point, src/sim/simConfig.js) may change their content.
 * Everything else must read through the registry. See src/data/DATA_LAYOUT.md.
 */
import { DATA_FILES } from './dataFiles.generated.js';
import { assembleBundle } from './dataLayout.js';

const bundle = assembleBundle(DATA_FILES);

export const defaultUnitsVisuals = bundle.unitsVisuals;
export const defaultUnitStats = bundle.unitStats;
export const defaultBuildingsData = bundle.buildings;
export const defaultBuildingVisuals = bundle.buildingVisuals;
export const defaultHeroesData = bundle.heroes;
export const defaultEngineConfig = bundle.engineConfig;
