import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const identity = await import("../lib/identity.js");

// 0.2.1-rc.2 的 dsh-agent-loop 不再注册 cwd 提示词变量，改由 dsh-working-directory
// 的 working-directory:current context 提供工作目录。插件若还在 persona 文本里写
// {{cwd}}，整轮 assemble 会抛 unknown prompt variable，用户发消息直接失败。
// 这组测试锁住「插件自己的文件不得再产出该变量」这条约束。

const SOURCES = ["lib/identity.js", "lib/core.js", "cordis.patch.yml"];

/**
 * 判断源码里是否还有「会进入宿主的」{{cwd}}。
 * 两类合法例外：注释、以及拿旧文本做比对的识别白名单
 * （LEGACY_CWD_ONLY_TEXTS、isDisposableYamlFoldParagraph 里的 t === "..."）。
 * 除此之外出现就是真产出，必须为 0。
 */
function producingCwdToken(text) {
  const lines = String(text).split(/\r?\n/);
  let inLegacyBlock = false;
  return lines.some((line) => {
    if (/^\s*(\/\/|#|\*|\/\*)/.test(line)) return false;
    if (/LEGACY_CWD_ONLY_TEXTS/.test(line)) inLegacyBlock = true;
    if (inLegacyBlock) {
      if (/^\s*\]\);/.test(line)) inLegacyBlock = false;
      return false;
    }
    // 纯比对：t === "..." / t.startsWith("...") / .includes("...")
    if (/\b(t|para)\s*(===|!==|\.startsWith|\.includes)/.test(line)) return false;
    return line.includes("{{cwd}}");
  });
}

test("插件源文件不再产出 {{cwd}} 提示词变量", () => {
  for (const rel of SOURCES) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    assert.equal(producingCwdToken(text), false, `${rel} 仍在产出 {{cwd}}`);
  }
});

test("persona 补丁层不覆盖 personaSuffix", () => {
  const yaml = fs.readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
  const systemPromptBlock = yaml
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  assert.equal(/personaSuffix:/.test(systemPromptBlock), false);
});

test("只剩工作目录的 suffix 文案不含任何变量", () => {
  assert.equal(identity.CWD_ONLY_SUFFIX.includes("{{"), false);
  assert.equal(identity.CWD_ONLY_SUFFIX.trim().length > 0, true);
});

test("官方身份句里的 {{cwd}} 被整句删除，而不是改写成另一个 {{cwd}}", async () => {
  const { renderPrompt } = await import(
    "file:///J:/Harness/_dshdiff/full210y/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js"
  ).catch(() => ({ renderPrompt: null }));

  const assembly = {
    sections: [
      {
        name: "deployment:persona-suffix",
        text: "You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.",
      },
    ],
    contexts: [],
    tools: [],
    variables: { provider: "p", model: "m" },
  };
  const result = identity.rewritePromptAssembly(assembly, {
    fallbackInject: "",
    capabilityProtocol: false,
    context: {},
  });
  const joined = JSON.stringify(result.sections);
  assert.equal(/\{\{cwd\}\}/.test(joined), false);

  // 装了 0.2.1 宿主时，直接交给它真实渲染器验证不抛错。
  if (renderPrompt) assert.doesNotThrow(() => renderPrompt(result));
});
