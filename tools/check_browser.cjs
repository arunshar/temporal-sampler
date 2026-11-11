"use strict";

// This audit opens the site directly and never starts a local server.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { createHash } = require("node:crypto");
const playwrightPath = process.env.PLAYWRIGHT_MODULE || "playwright-core";
const { chromium } = require(playwrightPath);

const [siteArgument, outputArgument, ...extra] = process.argv.slice(2);
const liveArgument = extra[0] === "--url" ? extra[1] : extra[0];
if (!siteArgument || !outputArgument || extra.length > 2 ||
    (extra.length === 2 && extra[0] !== "--url") || (extra[0] === "--url" && !extra[1])) {
  console.error("Usage: node check_browser.cjs SITE_PATH OUTPUT_DIRECTORY [--url LIVE_URL]");
  process.exit(2);
}

const requestedPath = path.resolve(siteArgument);
const outputDirectory = path.resolve(outputArgument);
const report = {
  result: "running",
  mode: liveArgument ? "live" : "local",
  startedAt: new Date().toISOString(),
  source: requestedPath,
  target: null,
  browser: null,
  checks: [],
  viewports: [],
  globalErrors: []
};
let browser;
let reportPath;

const errorText = error => error instanceof Error ? error.message : String(error);
const digest = text => createHash("sha256").update(text).digest("hex");
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

async function check(viewport, name, action) {
  try {
    const detail = await action();
    report.checks.push({ viewport, name, status: "pass", detail });
    console.log(`PASS ${viewport}: ${name}`);
    return true;
  } catch (error) {
    report.checks.push({ viewport, name, status: "fail", error: errorText(error) });
    console.error(`FAIL ${viewport}: ${name}: ${errorText(error)}`);
    return false;
  }
}

async function settleMedia(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, async image => {
      image.loading = "eager";
      try { await image.decode(); } catch (_) { /* The asset check reports failed images. */ }
    }));
  });
}

async function dimensions(page) {
  return page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    documentHeight: document.documentElement.scrollHeight
  }));
}

async function assertWidth(page) {
  const values = await dimensions(page);
  assert(values.documentWidth <= values.viewportWidth + 1,
    `The document is ${values.documentWidth}px wide at a ${values.viewportWidth}px viewport.`);
  assert(values.bodyWidth <= values.viewportWidth + 1,
    `The body is ${values.bodyWidth}px wide at a ${values.viewportWidth}px viewport.`);
  return values;
}

async function timelineState(page) {
  const state = await page.locator("#timeline").evaluate(element => {
    const svg = element.matches("svg") ? element : element.querySelector("svg");
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    return {
      markup: svg.outerHTML,
      text: svg.textContent.trim(),
      width: box.width,
      height: box.height,
      marks: svg.querySelectorAll("rect, circle, line, path, polyline, polygon").length
    };
  });
  assert(state, "The timeline has no SVG.");
  assert(state.width > 0 && state.height > 0, "The timeline SVG has no visible area.");
  assert(state.marks > 0, "The timeline SVG has no drawn marks.");
  assert(!/\b(?:NaN|undefined|Infinity)\b/.test(state.markup), "The timeline SVG contains an invalid value.");
  return { text: state.text, width: state.width, height: state.height, marks: state.marks, sha256: digest(state.markup) };
}

async function expandedState(page) {
  return page.evaluate(() => {
    const navigation = document.querySelector("#site-nav");
    const button = document.querySelector("#menu-toggle");
    return navigation?.getAttribute("aria-expanded") ?? button?.getAttribute("aria-expanded");
  });
}

async function inspectViewport(targetURL, siteRoot, viewport) {
  const name = viewport.name;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "reduce",
    colorScheme: "light",
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const record = {
    name,
    width: viewport.width,
    height: viewport.height,
    console: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
    blockedRequests: [],
    loadedAssets: [],
    screenshots: []
  };
  report.viewports.push(record);
  const allowedOrigin = liveArgument ? new URL(targetURL).origin : null;
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const allowed = ["file:", "data:", "blob:", "about:"].includes(url.protocol) ||
      (allowedOrigin !== null && url.origin === allowedOrigin);
    if (allowed) await route.continue();
    else {
      record.blockedRequests.push(url.href);
      await route.abort("blockedbyclient");
    }
  });
  page.on("console", message => record.console.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", error => record.pageErrors.push(errorText(error)));
  page.on("requestfailed", request => record.failedRequests.push({
    url: request.url(), error: request.failure()?.errorText || "The request failed."
  }));
  page.on("response", response => {
    if (response.status() >= 400) record.badResponses.push({ url: response.url(), status: response.status() });
    if (["script", "stylesheet", "image", "font"].includes(response.request().resourceType())) {
      record.loadedAssets.push({ url: response.url(), status: response.status(), type: response.request().resourceType() });
    }
  });

  try {
    const loaded = await check(name, "The page loads from the selected target.", async () => {
      const response = await page.goto(targetURL, { waitUntil: "load", timeout: 30000 });
      if (liveArgument) assert(response && response.ok(), `The live page returned ${response?.status()}.`);
      await settleMedia(page);
      assert.equal(await page.locator("h1").count(), 1, "The page must have one h1.");
      return { title: await page.title(), url: page.url() };
    });
    if (!loaded) return;

    await check(name, "The document fits the viewport.", () => assertWidth(page));
    await check(name, "Local assets and images resolve.", async () => {
      const assets = await page.evaluate(() => {
        const attribute = element => element.hasAttribute("src") ? "src" : "href";
        const references = Array.from(document.querySelectorAll(
          "script[src], link[rel='stylesheet'][href], link[rel='icon'][href], img[src], source[src], a[href]"
        ), element => new URL(element.getAttribute(attribute(element)), document.baseURI).href);
        return {
          references: Array.from(new Set(references)),
          brokenImages: Array.from(document.images).filter(image => !image.complete || !image.naturalWidth)
            .map(image => image.currentSrc || image.src),
          fonts: Array.from(document.fonts, font => ({ family: font.family, status: font.status }))
        };
      });
      assert.deepEqual(assets.brokenImages, [], "The page contains images that did not load.");
      const localFiles = [];
      for (const href of assets.references) {
        const url = new URL(href);
        if (url.protocol !== "file:") continue;
        const filename = fileURLToPath(url);
        if (!within(siteRoot, filename)) continue;
        const stat = await fs.stat(filename);
        if (stat.isDirectory()) await fs.access(path.join(filename, "index.html"));
        localFiles.push(filename);
      }
      assert(assets.fonts.every(font => font.status === "loaded"), "A declared font did not load.");
      return { checkedLocalFiles: localFiles, fontFaces: assets.fonts, imageCount: await page.locator("img").count() };
    });

    const initialScreenshot = path.join(outputDirectory, `${report.mode}-${name}-initial.png`);
    await page.screenshot({ path: initialScreenshot, fullPage: true });
    record.screenshots.push(initialScreenshot);
    // Focused images preserve readable text when the complete page is very tall.
    for (const [label, selector] of [
      ["hero", ".hero"], ["architecture", ".teaser"],
      ["experiment", "#experiments .lab"], ["comparison", ".bar-compare"],
      ["replay", "#replay-lab"], ["glossary", "#glossary"]
    ]) {
      const screenshot = path.join(outputDirectory, `${report.mode}-${name}-${label}.png`);
      await page.locator(selector).screenshot({ path: screenshot });
      record.screenshots.push(screenshot);
    }

    await check(name, "Every scenario exposes recorded runs and a valid timeline.", async () => {
      const selector = page.locator("#scenario-select");
      const options = await selector.locator("option").evaluateAll(elements => elements
        .filter(element => !element.disabled && element.value !== "")
        .map(element => ({ value: element.value, label: element.textContent.trim() })));
      assert.equal(options.length, 8, "The scenario selector must contain eight usable scenarios.");
      assert.equal(new Set(options.map(option => option.value)).size, options.length, "Scenario values must be unique.");
      const states = [];
      for (const option of options) {
        const previousValue = await selector.inputValue();
        const previousSummary = (await page.locator("#scenario-summary").textContent()).trim();
        await selector.selectOption(option.value);
        await page.waitForFunction(value => document.querySelector("#scenario-select").value === value &&
          document.querySelector("#run-select").options.length > 0, option.value);
        if (previousValue !== option.value) {
          await page.waitForFunction(previous => document.querySelector("#scenario-summary").textContent.trim() !== previous,
            previousSummary);
        }
        const summary = (await page.locator("#scenario-summary").textContent()).trim();
        assert(summary.length > 0, "The scenario summary is empty.");
        if (option.value === "f2") assert(summary.includes("pending Activity status"), "The outage must explain the experiment observations.");
        if (option.value === "f4") assert(summary.includes("average of the generated fields") && summary.includes("stopped retries"), "The physics failure needs its scope and retry outcome.");
        const runSelector = page.locator("#run-select");
        const runs = await runSelector.locator("option").evaluateAll(elements => elements
          .filter(element => !element.disabled && element.value !== "")
          .map(element => ({ value: element.value, label: element.textContent.trim() })));
        assert(runs.length > 0, `Scenario ${option.value} has no selectable recorded runs.`);
        assert.equal(new Set(runs.map(run => run.value)).size, runs.length, "Recorded run values must be unique.");
        const runStates = [];
        for (const run of runs) {
          await runSelector.selectOption(run.value);
          assert.equal(await runSelector.inputValue(), run.value);
          const timeline = await timelineState(page);
          const description = await page.locator("#timeline").getAttribute("aria-label");
          assert(description.includes("runner began the request") && description.includes("Workflow-start event"), "The timeline must distinguish its time origins.");
          const workerKilled = ["f1-hb", "f1-nohb", "f6"].includes(option.value);
          assert.equal(timeline.text.includes("Worker killed"), workerKilled, `Worker marker is incorrect for ${run.value}.`);
          assert.equal(await page.locator("#kill-legend").isVisible(), workerKilled, `Worker legend is incorrect for ${run.value}.`);
          runStates.push({ ...run, timeline });
        }
        states.push({ ...option, summary, runs: runStates });
      }
      return states;
    });

    await check(name, "Every architecture button updates its explanation.", async () => {
      const buttons = page.locator("#architecture button[data-node]");
      const count = await buttons.count();
      assert(count >= 2, "The architecture needs multiple explorable nodes.");
      const states = [];
      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const previous = (await page.locator("#node-detail").textContent()).trim();
        await button.click();
        if (index > 0) {
          await page.waitForFunction(old => document.querySelector("#node-detail").textContent.trim() !== old, previous);
        }
        const detail = (await page.locator("#node-detail").textContent()).trim();
        assert(detail.length > 0, "The architecture explanation is empty.");
        states.push({ node: await button.getAttribute("data-node"), detail });
      }
      return states;
    });

    await check(name, "Replay variants produce distinct explanations.", async () => {
      const selector = page.locator("#replay-variant");
      const variants = await selector.locator("option").evaluateAll(elements => elements
        .filter(element => !element.disabled && element.value !== "")
        .map(element => ({ value: element.value, label: element.textContent.trim() })));
      assert(variants.length >= 2, "The replay lesson needs multiple variants.");
      const states = [];
      for (const variant of variants) {
        const previousValue = await selector.inputValue();
        const previousOutput = (await page.locator("#replay-output").textContent()).trim();
        await selector.selectOption(variant.value);
        if (previousValue !== variant.value) {
          await page.waitForFunction(old => document.querySelector("#replay-output").textContent.trim() !== old,
            previousOutput);
        }
        const output = (await page.locator("#replay-output").textContent()).trim();
        assert(output.length > 0, "The replay explanation is empty.");
        states.push({ ...variant, output });
      }
      assert(new Set(states.map(state => state.output)).size > 1, "All replay variants returned the same explanation.");
      const same = states.find(state => state.value === "same");
      assert(same && same.output.includes("History supplies the recorded Infer result"), "Replay must distinguish the recorded result from Workflow decisions.");
      return states;
    });

    await check(name, "Glossary search filters and restores its entries.", async () => {
      const search = page.locator("#glossary-search");
      const entries = page.locator(".glossary-entry");
      await search.fill("");
      const total = await entries.count();
      assert(total > 0, "The glossary has no entries.");
      const initial = await entries.first().innerText();
      const term = initial.match(/[A-Za-z][A-Za-z-]{2,}/)?.[0];
      assert(term, "The glossary has no searchable term.");
      await search.fill(term);
      assert(await page.locator(".glossary-entry:visible").count() > 0, "A known glossary term returned no entries.");
      await search.fill("zzzxxyynotaword");
      await page.waitForFunction(() => Array.from(document.querySelectorAll(".glossary-entry"))
        .every(element => !element.getClientRects().length || getComputedStyle(element).visibility === "hidden"));
      await search.fill("");
      assert.equal(await page.locator(".glossary-entry:visible").count(), total, "Clearing search did not restore every entry.");
      return { entries: total, testedTerm: term };
    });

    await check(name, "The theme control changes the document theme.", async () => {
      const before = await page.locator("html").getAttribute("data-theme");
      await page.locator("#theme-toggle").click();
      await page.waitForFunction(old => document.documentElement.dataset.theme !== old, before);
      const after = await page.locator("html").getAttribute("data-theme");
      assert(["light", "dark"].includes(after), `The theme value is ${after}.`);
      const screenshot = path.join(outputDirectory, `${report.mode}-${name}-${after}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      record.screenshots.push(screenshot);
      await page.locator("#theme-toggle").click();
      return { before, after };
    });

    if (name === "mobile") {
      await check(name, "The mobile menu exposes and closes its navigation.", async () => {
        const toggle = page.locator("#menu-toggle");
        assert(await toggle.isVisible(), "The mobile menu control is hidden.");
        let before = await expandedState(page);
        assert(["true", "false"].includes(before), "The mobile navigation has no aria-expanded state.");
        if (before === "true") await toggle.click();
        await toggle.click();
        assert.equal(await expandedState(page), "true", "Opening the menu did not update aria-expanded.");
        assert(await page.locator("#site-nav").isVisible(), "The expanded navigation is hidden.");
        await assertWidth(page);
        await toggle.click();
        assert.equal(await expandedState(page), "false", "Closing the menu did not update aria-expanded.");
        return { expanded: "true", collapsed: "false" };
      });
    }

    await check(name, "Hash navigation reaches real section targets.", async () => {
      const links = await page.locator("#site-nav a[href^='#']").evaluateAll(elements => elements
        .filter(element => element.getAttribute("href").length > 1)
        .map(element => ({ hash: element.getAttribute("href"), label: element.textContent.trim() })));
      assert(links.length > 0, "The navigation has no section links.");
      const missing = await page.evaluate(items => items.filter(item =>
        !document.getElementById(decodeURIComponent(item.hash.slice(1)))), links);
      assert.deepEqual(missing, [], "The navigation names missing section targets.");
      const targets = [links[0], links[links.length - 1]];
      for (const target of targets) {
        const toggle = page.locator("#menu-toggle");
        if (await toggle.isVisible() && await expandedState(page) !== "true") await toggle.click();
        const link = page.locator("#site-nav a").filter({ hasText: target.label }).first();
        await link.click();
        await page.waitForFunction(hash => location.hash === hash, target.hash);
        const box = await page.locator(`#${target.hash.slice(1)}`).boundingBox();
        assert(box, `The target ${target.hash} has no visible box.`);
        assert(box.y < viewport.height && box.y + box.height > 0, `The target ${target.hash} did not enter the viewport.`);
      }
      return { links, clicked: targets };
    });

    await check(name, "The document still fits after interaction.", () => assertWidth(page));
    await check(name, "The page has no browser errors or missing requests.", async () => {
      assert.deepEqual(record.pageErrors, [], "The page raised JavaScript errors.");
      assert.deepEqual(record.console.filter(message => message.type === "error"), [], "The console contains errors.");
      assert.deepEqual(record.badResponses, [], "The page requested an HTTP resource that failed.");
      assert.deepEqual(record.failedRequests, [], "The page requested resources that did not load.");
      assert.deepEqual(record.blockedRequests, [], "The page depends on resources outside the permitted origin.");
      return { consoleWarnings: record.console.filter(message => message.type === "warning"), assets: record.loadedAssets.length };
    });
  } finally {
    await context.close();
  }
}

(async () => {
  try {
    const stat = await fs.stat(requestedPath);
    const indexPath = stat.isDirectory() ? path.join(requestedPath, "index.html") : requestedPath;
    await fs.access(indexPath);
    const siteRoot = path.dirname(indexPath);
    assert(!within(siteRoot, outputDirectory), "The output directory must stay outside the public site folder.");
    await fs.mkdir(outputDirectory, { recursive: true });
    reportPath = path.join(outputDirectory, `${report.mode}-browser-report.json`);
    const targetURL = liveArgument ? new URL(liveArgument).href : pathToFileURL(indexPath).href;
    if (liveArgument) assert(["http:", "https:"].includes(new URL(targetURL).protocol), "The live URL must use HTTP or HTTPS.");
    report.target = targetURL;
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || undefined,
      headless: true,
      args: ["--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-sync", "--no-first-run"]
    });
    report.browser = await browser.version();
    for (const viewport of [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 }
    ]) await inspectViewport(targetURL, siteRoot, viewport);
  } catch (error) {
    report.globalErrors.push(errorText(error));
    console.error(`FAIL browser audit: ${errorText(error)}`);
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    report.result = report.globalErrors.length === 0 && report.checks.length > 0 &&
      report.checks.every(item => item.status === "pass") ? "pass" : "fail";
    if (reportPath) await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`BROWSER_CHECK: ${report.result.toUpperCase()}`);
    if (reportPath) console.log(`The browser report is ${reportPath}.`);
    process.exitCode = report.result === "pass" ? 0 : 1;
  }
})();
