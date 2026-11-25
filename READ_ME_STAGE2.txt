Stage 2 package.
1) Extract this zip into the project root (overwrite).
2) Delete the old monolithic files (they are replaced by src/data/races, bases, shared):
   git rm src/data/visuals/units.json src/data/unitStats.json src/data/buildings.json src/data/buildingVisuals.json src/data/heroes.json src/data/engineConfig.json
3) git add . ; git status ; commit ; push.
