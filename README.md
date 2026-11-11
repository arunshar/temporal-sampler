# Temporal around a sampler

This repository contains an illustrated guide to Durable Execution around a physics-checked generative model. It accompanies Arun Sharma's proposed Replay 2027 talk, "Durable Execution Around a Sampler".

The website explains the model request, the Temporal components and the failure experiments. It includes a scenario explorer, an actual-run sampler timeline, a conceptual replay illustration, a searchable glossary, six technical chapters and downloadable slides.

The public guide is at [the companion website](https://arunshar.com/temporal-sampler/).

## The evidence has a specific scope.

Every campaign measurement used one Apple M4 Pro laptop CPU, a demo-scale model and five runs per scenario. The model has a 64 by 64 tile, base width 32, no attention and brief synthetic training. The Temporal dev server used a local database file.

The failure-to-next-attempt medians of 9.953 seconds and 117.873 seconds are consistent with the chosen 10-second Heartbeat Timeout and 2-minute Start-To-Close Timeout. The measured interval includes backoff, Worker availability and dispatch delay. It does not isolate an internal timeout detector.

Recovery ran the sampler twice in all 15 Worker-kill runs. The shorter wait did not save compute. The physics gate checks the ensemble mean only. Matching seeded metrics on this CPU do not establish full field identity or reproducibility on other hardware.

The live unavailable-agent scenario returned a template from Report. Only a mocked test exercised the separate report-unavailable Workflow branch. The replacement experiment covers one code transition, and the separate replay test uses one saved history.

This is a research system, not a commercial production deployment. The first retry start in the brief outage, full field identity, other-hardware reproducibility, remote CI and container builds of the research runtime remain UNVERIFIED.

## The repository contains an educational companion.

| Path | The path contains this material. |
|---|---|
| `index.html` | The generated page includes all prose and the static evidence table. |
| `assets/` | The styles, interactions, figures and locally hosted licensed fonts support the site. |
| `content/deep-dive.json` | The six chapters explain the technical mechanics. |
| `content/site.json` | The repository and website URLs configure the generated page. |
| `evidence/` | The curated records include all 40 measured runs, history excerpts, repeated-seed metrics and provenance. |
| `code/` | The exact code excerpts and their hash manifest trace to research commit `9aa337d`. |
| `downloads/` | The PDF, PowerPoint with notes and contact sheet preserve the visually reviewed draft deck. |
| `tools/` | The builder and checks support local editing and verification. |

The full Temporal runtime, raw histories, runtime logs and model artifacts are excluded. The code excerpts are documentation, not a standalone Go package. The browser interactions display recorded evidence or a clearly labeled conceptual illustration. They do not run Temporal or execute model inference.

The wider [PC-RF project page](https://arunshar.com/projects/pcrf/) explains the model research. Its other benchmarks use different configurations. The [PC-RF repository](https://github.com/arunshar/pc-rf) holds the broader modeling project.

## You can read and build the site locally.

The checked-in HTML works directly from disk. Open `index.html` in a browser. The site uses no CDN, remote font, analytics service or backend.

Python's standard library builds and checks the page. No Python package installation is required.

```sh
python3 tools/build.py
python3 tools/check_content.py
```

The browser check requires Node, Playwright Core and an installed Chrome or Chromium. Set `PLAYWRIGHT_MODULE` to the installed module path if it is outside the normal module search path. Set `CHROME_PATH` to a browser executable when needed. Keep audit output outside the website folder.

```sh
node tools/check_browser.cjs . ../replay-site-audit
```

The browser check opens `file://` pages and blocks HTTP requests in local mode. It tests desktop and mobile views, every observed scenario, every run selector, architecture details, replay choices, glossary search, themes, navigation, fonts, links and document overflow.

## You can inspect and change the content.

Edit `content/deep-dive.json` for the chapters. Edit `tools/build.py` for the surrounding explanation and page structure. Edit `assets/site.css` and `assets/site.js` for appearance and interaction. Run the builder and both checks after a change.

The provenance file names the frozen inputs and their hashes. The content check recomputes scenario medians and ranges from the included run records and verifies the source-excerpt hashes. New measurements should receive their own provenance and scope. Existing values should stay connected to the saved records.

The branch-based GitHub Pages site serves the repository root. The `.nojekyll` file keeps the static assets unchanged.

## The licenses travel with the files.

The website code, prose and pinned source excerpts use the MIT license in `LICENSE`. Inter and Noto Sans Mono retain their SIL Open Font License files in `assets/fonts/`. The material is an independent research explanation and does not imply endorsement by Temporal or acceptance of the proposed talk.
