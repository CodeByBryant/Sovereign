# Sovereign documentation

| Start here                         |                                                              |
| ---------------------------------- | ------------------------------------------------------------ |
| [architecture.md](architecture.md) | How the packages fit together and how a world gets on screen |
| [development.md](development.md)   | Setup, commands, test layout, CI, measured performance       |
| [roadmap.md](roadmap.md)           | Where this is going, phase by phase                          |

| Reference                                                                |                                              |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| [architecture/dependency-diagram.md](architecture/dependency-diagram.md) | The package graph and who owns which library |
| [simulation/determinism.md](simulation/determinism.md)                   | The normative determinism specification      |
| [simulation/save-format.md](simulation/save-format.md)                   | The save file layout                         |
| [terrain.md](terrain.md)                                                 | The terrain pipeline                         |
| [nations.md](nations.md)                                                 | Nation spawning and the political map        |
| [save-load.md](save-load.md)                                             | How the browser app stores saves             |

| Decisions                                                                |                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------- |
| [0001 Separate the engine](decisions/0001-separate-simulation-engine.md) | Why `@sovereign/simulation` knows nothing about the app |
| [0002 Workspace layout](decisions/0002-workspace-layout.md)              | Why five packages and three apps                        |
| [0003 Determinism policy](decisions/0003-determinism-policy.md)          | What "deterministic" means here and how it is enforced  |
