# Morphoid Studio

Parametric FDM collectible generator. Pipeline: **genome (Morphotyp) → rig → 2D / 3D → bake → STL/3MF**.

Status: Stage 0 (core) + Stage 1 (2D editor) done. Stage 2 (Three.js viewport) is next.

```
npm install
npm run dev       # editor at http://localhost:5173
npm test          # vitest
npm run typecheck
npm run build
```

npm run audit -- 200 whole    # print audit over random Morphoids (or: modular)

Docs: `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/ELEMENT_CONTRACT.md` (the 2D↔3D↔print rule).
