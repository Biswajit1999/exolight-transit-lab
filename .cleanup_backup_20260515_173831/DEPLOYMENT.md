# Deployment

This is a Vite + React + TypeScript project. Unlike the earlier static ExoLight build, it must be built before GitHub Pages can serve it.

## GitHub Pages via Actions

Use `.github/workflows/deploy.yml` and set:

```text
Settings → Pages → Source → GitHub Actions
```

## Local build

```bash
npm install
npm run build
npm run preview
```
