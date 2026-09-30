import { describe, expect, it } from "vitest";
import { Script, runInNewContext } from "node:vm";
import { i18nClient, readCatalogs, translateMessage } from "../src/i18n.js";
import { renderWorkspace } from "../src/workspace-ui.js";

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
