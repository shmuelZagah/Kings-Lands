# Kings Lands — Architecture Rules

This document defines the project's mandatory architectural invariants. These rules apply to all implementation work, regardless of task, phase, or AI session.

**Rule priority:** Explicitly approved architectural decisions in this document take precedence over older GDD descriptions where they conflict. New requirements do not automatically authorize breaking an existing invariant. If a requirement conflicts with a rule, identify the conflict and propose a resolution before implementation.

## 1. Engine & Rendering — Full 3D

- **Full 3D Environment:** The game is fully 3D, rendered with WebGL through Three.js. Do not replace 3D gameplay with 2.5D or fake-3D representations.
- **Asset Loading (`ModelFactory`):** Visual assets must go through the established asset-adapter / `ModelFactory` abstraction. Procedural meshes are supported; the architecture must preserve the ability to switch to external `.gltf` / `.glb` assets without rewriting gameplay systems.
- **Thread Ownership:** Rendering runs on the Main Thread. The renderer consumes simulation snapshots and interpolates between snapshots for smooth presentation; it must not mutate authoritative simulation state.
- **Presentation Separation:** Three.js objects, animation mixers, materials, and other rendering objects belong to the presentation layer. They must not be imported into authoritative simulation or AI logic.
- **Resource Lifecycle:** Dispose of GPU resources and remove scene objects, listeners, and animation resources according to the established ownership and lifecycle rules.

## 2. Deterministic Simulation & Worker

- **Worker Isolation:** Authoritative gameplay simulation under `src/sim/` runs inside the dedicated Web Worker at a fixed rate of 20 ticks per second (50 ms per tick), unless an explicitly approved architecture change updates this contract.
- **Authoritative Fixed-Point Arithmetic:** Gameplay calculations that affect authoritative simulation outcomes must use the project's fixed-point utilities in `src/core/fx.js` (`FX_ONE = 1024`) and established integer conventions. Do not introduce floating-point gameplay calculations where fixed-point arithmetic is required.
- **Forbidden Nondeterministic Inputs:** Do not use `Math.random()`, wall-clock time (`Date.now()` or equivalent), or platform-dependent floating-point trigonometry in authoritative simulation or AI logic. Use the established seeded `xorshift32` RNG, lookup tables, and fixed-point helpers.
- **Deterministic Ordering:** Iterate entities and process competing actions in the project's established deterministic order, including ascending Entity ID where required. Never rely on incidental object-key, Map, Set, or insertion ordering when it can affect gameplay outcomes.
- **Deterministic Side Effects:** Simulation outcomes must not depend on rendering frame rate, UI timing, browser timing, asynchronous completion order, or network timing.
- **Explicit Randomness:** Random outcomes must use the simulation's seeded RNG. Define how RNG state is initialized, advanced, and preserved if save/load or replay support depends on it.
- **Tick-Based Gameplay Time:** Gameplay cooldowns, durations, regeneration, construction, and other simulation timers must be expressed in simulation ticks or the project's established deterministic time representation, not wall-clock time.
- **Floating Point Boundary:** Floating-point calculations may be used in presentation-only code where appropriate. They must not leak back into authoritative gameplay decisions.

## 3. State Ownership & Communication

- **Single Source of Truth:** The simulation owns authoritative gameplay state. The UI, renderer, tools, and external AI controllers must not directly mutate `GameState`.
- **Command-Driven Actions:** Player and external-controller actions must be represented by serializable commands and sent through the established `CommandBus` / simulation bridge. The simulation validates and processes commands at the defined tick boundary.
- **Worker Message Contracts:** Messages crossing the Main Thread / Worker boundary must follow the existing message schema and serialization rules. Do not pass Three.js objects, functions, DOM objects, or other non-serializable presentation objects through the bridge.
- **Snapshot Ownership:** Follow the existing snapshot and double-buffered TypedArray ownership contract. Do not retain, mutate, or reuse a buffer beyond its documented lifetime. Confirm transfer and buffer-reuse behavior in the actual implementation before changing it.
- **Events vs. Commands:** Commands request an authoritative state change; events report that something happened. Do not use presentation events as a back door for mutating simulation state.
- **Validation at the Boundary:** Validate command types, entity references, ownership/team permissions, and payload shape at the appropriate simulation boundary. Invalid commands must fail safely and predictably.
- **No Bypass Paths:** Do not bypass the CommandBus, simulation bridge, or ownership boundaries merely to make a feature easier to implement.

## 4. Game Mechanics Invariants

- **Building Progression:** Buildings auto-level based on XP gained from recruiting units; manual paid upgrades must not be reintroduced unless the design is explicitly revised.
- **Resource Management:** Wood is exclusively used for buildings and archers under the current game rules. Trees regenerate according to the established simulation timer.
- **Hero Progression:** Heroes gain XP through combat proximity and unlock abilities sequentially without manual skill-point allocation. Passive abilities remain always active and are not manually clickable.
- **Global Spellbook:** Players accumulate global power points during a match to unlock powers in the global spell tree, accessible through the Palantir minimap UI.
- **Mechanic Preservation:** New features must preserve these invariants and other documented game rules unless a change is explicitly requested and approved.

## 5. Data-Driven Design & Configuration Integrity

- **Data-Driven Gameplay:** Unit stats, building stats, costs, ability cooldowns, progression values, and other balance parameters belong in the established `src/data/*.json` configuration files wherever the current data architecture supports them.
- **No Duplicated Authoritative Constants:** Do not duplicate gameplay constants across JSON, simulation code, UI code, and rendering code. Keep a single authoritative source and consume it through established interfaces.
- **Schema Consistency:** New or modified JSON data must conform to the actual schema and conventions used by its consumers. Inspect the consuming code before changing a schema.
- **Reference Integrity:** Validate cross-references among units, buildings, abilities, factions, animations, and other data-driven definitions where applicable.
- **Explicit Defaults:** Missing, invalid, or optional configuration values must follow documented defaults and validation rules. Do not silently invent gameplay values.
- **Safe Failure:** Invalid configuration should produce a clear, actionable diagnostic rather than silently corrupting gameplay state.
- **Persisted Data Compatibility:** If a data format used by saves or other persisted state changes, define the necessary versioning or migration behavior before shipping the change.

## 6. Existing Codebase Integrity & API Contracts

- **Inspect Before Implementing:** Before modifying an existing system, inspect its actual source code, exports, callers, dependencies, and relevant data contracts. Documentation and previous conversation summaries are useful maps, but are not substitutes for current source code.
- **No Invented Interfaces:** Never assume a class, method, export, property, event, command, file, or field exists without verifying it in the current repository.
- **Preserve Existing Behavior:** Existing functionality must remain intact unless the task explicitly requires changing it. Extend existing systems rather than creating competing implementations or bypasses.
- **API Change Propagation:** If an interface must change, identify its consumers, update all affected call sites consistently, and document the change.
- **Minimal Scope:** Modify only files required for the task and its integration. Avoid unrelated refactoring, renaming established interfaces, or replacing entire modules without a demonstrated need.
- **Resolve Uncertainty:** If an important contract cannot be verified, inspect further. If it remains uncertain, state the uncertainty and avoid silently guessing.

## 7. Cross-System Integration & Lifecycle

- **Trace Dependencies:** Before implementation, identify upstream dependencies, downstream consumers, and systems likely to be affected.
- **Respect Boundaries:** Integrate through established APIs, commands, events, and data contracts.
- **Complete Integration:** A feature is not complete merely because its module exists. Required imports, registrations, handlers, data definitions, event subscriptions, UI connections, and cleanup paths must also be connected.
- **Lifecycle Completeness:** Consider initialization, normal updates, cancellation, entity destruction, scene changes, and cleanup wherever relevant.
- **No Hidden Side Effects:** A system must not silently mutate unrelated systems' internal state. Cross-system changes must use established interfaces.
- **Regression Awareness:** Consider effects on movement, combat, economy, production, rendering, AI, and other dependent systems as relevant to the change.
- **Document New Dependencies:** Record important new cross-system dependencies and externally consumed interfaces in the appropriate project documentation.

## 8. Performance & Resource Management

- **Simulation Budget:** Preserve the fixed simulation tick and avoid unnecessary work that causes sustained tick overruns.
- **Allocation Awareness:** Avoid unnecessary per-tick allocations and temporary objects in performance-critical paths, especially where existing zero-allocation patterns are intentional.
- **Use Existing Spatial Systems:** Prefer established spatial hashing, pathfinding, caching, and batching mechanisms where appropriate. Avoid repeated full-world scans in hot loops without a clear reason.
- **Rendering Efficiency:** Reuse established instancing, batching, and level-of-detail approaches where applicable.
- **Bounded Work:** Ensure searches, queues, caches, and background work have appropriate bounds or eviction policies when required.
- **Measure Before Complex Optimization:** Do not add complicated caching or optimization machinery without identifying a concrete bottleneck or requirement.
- **Correctness First:** Optimizations must preserve gameplay behavior and determinism.

## 9. Testing & Verification

- **Verify, Do Not Assume:** Do not claim an implementation works merely because the code was written or appears plausible.
- **Run Available Checks:** Use existing tests, build checks, linting, syntax checks, and validation tools when available and relevant.
- **Test Critical Invariants:** Changes affecting determinism, state transitions, resource accounting, entity lifecycle, pathfinding, or Worker messaging require appropriate verification.
- **Regression Testing:** Verify existing behavior affected by the change, not only the new feature.
- **Honest Reporting:** Distinguish checks that passed, checks that failed, checks not run, and behavior requiring manual testing.
- **No False Completion:** Do not mark a feature as fully verified when its acceptance criteria have not been tested.
- **Missing Test Infrastructure:** If suitable tests do not exist, identify the highest-value checks that can be performed and report remaining risk.

## 10. Project Structure & ES Modules

- **Modular Design:** Keep systems and logical components in dedicated ES modules under the established directory structure (for example, `src/sim/`, `src/render/`, `src/core/`, `src/ui/`, and `src/data/`).
- **No Monolithic Files:** Do not combine the entire project or unrelated classes and systems into one large HTML or JavaScript file.
- **Follow Existing Conventions:** Match the repository's existing naming, export, import, and file-placement conventions. Do not create a new organizational pattern without a reason.
- **Data Separation:** Keep configuration and visual definitions in independent JSON files where the current architecture specifies JSON.
- **Avoid Unnecessary Abstractions:** Introduce new layers or helper modules only when they provide a clear architectural benefit or match established patterns.

## 11. Living Documentation & AI Handoff

- **Update Project State:** At the end of each implementation task or phase, provide the updated content for `PROJECT_STATE.md` Sections 2 and 3, reflecting verified status, changed files, and actual active interfaces.
- **Document Actual Interfaces:** Record exports and externally consumed methods based on source code, not intended design or assumptions.
- **Distinguish Status:** Clearly distinguish implemented, integrated, tested, and fully verified work. Do not mark work complete solely because code was generated.
- **Update Architecture Rules Carefully:** If an approved change introduces a new global invariant, update this file. Do not add every local implementation detail to the architecture rules.
- **Task Handoff:** Summarize changes, important decisions, changed contracts, tests and results, remaining work, and known limitations so another session can continue without depending on hidden conversation context.
- **Repository Is the Memory:** The current source code and version-controlled documentation are the persistent project memory. Never rely on a previous chat being available or perfectly remembered.

## 12. Required Implementation Workflow

For each task:

1. Read this document, the current project state, and the task specification.
2. Inspect the repository structure and the actual source files involved.
3. Trace relevant callers, dependencies, message contracts, data schemas, and lifecycle paths.
4. Identify architectural conflicts, assumptions, and acceptance criteria before coding.
5. Implement the smallest complete change that satisfies the task and integrates with existing systems.
6. Run appropriate tests and validation checks, and inspect the final diff when tools permit.
7. Update project state and relevant documentation based on verified results.
8. Report changed files, integration details, verification performed, failures, and unresolved risks.

If the task conflicts with an invariant, do not silently violate the invariant. Explain the conflict and propose a resolution before making a consequential architectural change.
