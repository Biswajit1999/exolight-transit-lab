# ExoLight dataset provenance manifests

Each cached archival dataset can have a sidecar manifest under this directory.

For a light curve named:

```text
data/lightcurves/au-mic-b.json
```

the Evidence runtime looks for:

```text
data/provenance/au-mic-b.manifest.json
```

The manifest records the upstream archive, product identifier where known, retrieval time where known, local file path, transforms, and units. Missing historical metadata must remain `unknown`; do not replace missing archive information with guessed values or the current date.

Schema version:

```text
exolight-dataset-manifest-v1
```

A manifest may be scientifically useful while still partial. `src/data/datasetManifest.js` separates structural validity from completeness so historical caches can be represented honestly without blocking the application.
