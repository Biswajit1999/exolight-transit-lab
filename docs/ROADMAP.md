# ExoIntel-Prime Roadmap

This roadmap prioritises scientific clarity, reproducibility and accessibility before decorative expansion.

## Near term

- add more locally cached, provenance-tracked transit light curves;
- document target-by-target data sources and preprocessing;
- add independent browser/Python parity checks for selected model configurations;
- improve keyboard navigation, reduced-motion support and mobile layout;
- expose clearer uncertainty and residual diagnostics without implying a formal fit;
- add export of the current model state and plotted data.

## Medium term

- compare selected browser-model outputs against an established transit-modelling package;
- add uncertainty-weighted fitting as a separate, explicitly labelled analysis mode;
- support additional cadence and integration-time demonstrations;
- add reproducible examples for hotter, Sun-like and cooler host stars;
- improve provenance metadata for catalogue and light-curve fields;
- add a compact tutorial sequence for students and public demonstrations.

## Longer term

- investigate a modular model API and reusable analysis components;
- add controlled parameter priors and posterior inference only after validation;
- support community-contributed targets through reviewed pull requests;
- publish versioned releases with archived software citations;
- develop a reproducible benchmark set for model and rendering regressions.

## Scientific boundaries

The current public application is an interactive visualisation and educational modelling laboratory. It is not a professional detection pipeline, a validated exomoon detector or a formal orbital-parameter inference system. New features must keep measured data, catalogue metadata, theoretical models and hypothesis demonstrations visibly distinct.

## How to contribute

Start with the issue forms and read [`CONTRIBUTING.md`](../CONTRIBUTING.md). Small, well-documented improvements with clear provenance are preferred over large speculative additions.
