import { describe, expect, it } from "vitest";
import { Script, runInNewContext } from "node:vm";
import { i18nClient, readCatalogs, translateMessage } from "../src/i18n.js";
import { renderWorkspace } from "../src/workspace-ui.js";
import { dashboardClient } from "../src/dashboard-ui.js";

describe("workspace localization", () => {
  const catalogs = readCatalogs();
  it("ships complete bilingual catalogs with English interface text", () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs["zh-CN"]).sort());
    expect(translateMessage(catalogs.en, "en", "项目结构")).toBe("Project structure");
    expect(translateMessage(catalogs["zh-CN"], "zh-CN", "项目结构")).toBe("项目结构");
    for (const value of Object.values(catalogs.en)) expect(value).not.toMatch(/[\u3400-\u9fff]/);
  });
  it("preserves unknown evidence strings and source identifiers", () => {
    const log = "错误: 用户订单不存在 at src/订单.ts:12:3";
    expect(translateMessage(catalogs.en, "en", log)).toBe(log);
    expect(translateMessage(catalogs.en, "en", "workspace.test")).toBe("workspace.test");
  });
  it("preserves placeholders for dynamic architecture labels", () => {
    expect(catalogs.en["{count} 个模块存在循环依赖"]).toContain("{count}");
    expect(catalogs.en["扇入 {incoming} / 扇出 {outgoing}"]).toContain("{incoming}");
  });
  it("renders a valid bilingual client with escaped embedded resources", () => {
    const html = renderWorkspace("test-token");
    expect(html).toContain('id="language-selector"');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Script(script!)).not.toThrow();
  });
  it("localizes built-in server explanations and numeric comparison templates", () => {
    const picker = { value: "", append: () => {}, onchange: () => {} };
    const value = runInNewContext(
      i18nClient() +
        `
      ({ advice:tm('关联重跑尚未完成'),
         sample:tm('仅 3 项配对检查，少于探索性门槛 5'),
         missing:tm('2 个用例或重复轮次未配对'),
         unknown:tm('用户自定义说明：保留原文'),
         labels:localizedValues(()=>({status:t('通过')})) })`,
      {
        document: {
          title: "Canary",
          body: {},
          documentElement: {},
          createTreeWalker: () => ({ nextNode: () => false }),
          querySelectorAll: () => [],
          getElementById: () => picker,
          createElement: () => ({}),
        },
        location: { search: "?lang=en" },
        navigator: { languages: ["en"] },
        localStorage: { getItem: () => null },
        NodeFilter: { SHOW_TEXT: 4 },
        URLSearchParams,
      },
    );
    expect(value.advice).toBe("The linked rerun is not complete");
    expect(value.sample).toBe("Only 3 paired checks, below the exploratory threshold of 5");
    expect(value.missing).toBe("2 cases or repetitions are unpaired");
    expect(value.unknown).toBe("用户自定义说明：保留原文");
    expect(value.labels.status).toBe("Passed");
  });
  it("invalidates trend and run-selector caches when only the language changes", () => {
    const element = () => ({
      textContent: "",
      clientWidth: 640,
      hidden: false,
      dataset: {},
      value: "",
      children: [] as unknown[],
      append(...nodes: unknown[]) {
        this.children.push(...nodes);
      },
      replaceChildren(...nodes: unknown[]) {
        this.children = nodes;
      },
    });
    const elements = Object.fromEntries(
      ["run-selector", "trend-chart", "trend-tooltip", "trend-title", "trend-value", "trend-description"].map((id) => [
        id,
        element(),
      ]),
    );
    const context = {
      canaryLocale: "en",
      rows: [{ runId: "run_test", startedAt: "2026-09-30", status: "completed" }],
      selected: "run_test",
      trendMetric: "rate",
      dashboardStamp: "",
      labels: { completed: "Completed" },
      $: (id: string) => elements[id],
      document: { createElement: element },
      text: (_tag: string, value: string) => ({ ...element(), textContent: value }),
      historyDay: () => "2026-09-30",
      historyClock: () => "12:00",
      parentFor: () => undefined,
      runName: () => (context.canaryLocale === "en" ? "Project checks" : "项目检查"),
      short: () => "test",
      t: (key: string) => catalogs[context.canaryLocale][key] ?? key,
    };
    const selector = dashboardClient.match(/^function updateRunSelector\(\).*$/m)![0];
    const trend = dashboardClient.match(/^function renderTrend\(items\).*$/m)![0];
    const code = `${selector}\n${trend}\nupdateRunSelector();renderTrend([]);`;
    runInNewContext(code, context);
    expect(elements["trend-title"].textContent).toBe(catalogs.en["检查通过率趋势"]);
    const first = elements["run-selector"].children;
    context.canaryLocale = "zh-CN";
    context.labels.completed = "已完成";
    runInNewContext(code, context);
    expect(elements["trend-title"].textContent).toBe("检查通过率趋势");
    expect(elements["run-selector"].children).not.toBe(first);
    expect(elements["run-selector"].value).toBe("run_test");
  });
  it("switches repeatedly without navigation, translating only registered UI bindings", () => {
    const title = { nodeValue: " 项目结构 ", isConnected: true, parentElement: { closest: () => false } };
    const log = { nodeValue: "项目结构", isConnected: true, parentElement: { closest: () => true } };
    const picker = { value: "", append: () => {}, onchange: () => {} };
    const nodes = [title, log];
    let index = -1,
      url = "http://localhost:4318/?lang=zh-CN&runId=run_test&view=structure",
      events = 0;
    const document = {
      title: "Canary · 验证工作台",
      body: {},
      documentElement: { lang: "" },
      createTreeWalker: () => ({
        nextNode: () => ++index < nodes.length,
        get currentNode() {
          return nodes[index];
        },
      }),
      querySelectorAll: () => [],
      getElementById: () => picker,
      createElement: () => ({}),
    };
    const context = {
      document,
      location: { href: url, search: new URL(url).search },
      navigator: { languages: ["zh-CN"] },
      localStorage: { getItem: () => null, setItem: () => {} },
      history: {
        replaceState: (_state: unknown, _title: string, next: URL) => {
          url = String(next);
        },
      },
      window: {
        dispatchEvent: () => {
          events++;
        },
      },
      NodeFilter: { SHOW_TEXT: 4 },
      URL,
      URLSearchParams,
      Event,
    };
    runInNewContext(i18nClient(), context);
    for (const locale of ["en", "zh-CN", "en"]) {
      picker.value = locale;
      picker.onchange();
      expect(document.documentElement.lang).toBe(locale);
      expect(title.nodeValue).toBe(locale === "en" ? " Project structure " : " 项目结构 ");
      expect(log.nodeValue).toBe("项目结构");
      expect(new URL(url).searchParams.get("runId")).toBe("run_test");
      expect(new URL(url).searchParams.get("view")).toBe("structure");
    }
    expect(events).toBe(3);
  });
});
