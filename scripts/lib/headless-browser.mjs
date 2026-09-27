import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

export async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

export async function until(read, ready, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await read(); if (ready(value)) return value; }
    catch (error) { lastError = error; }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Verification timed out", { cause: lastError });
}

/** Application test browser; isolated profile, loopback debugging, no user browser state. */
export async function withBrowser(url, profile, task) {
  const executable = [process.env.CANARY_BROWSER_EXECUTABLE,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium", "/usr/bin/google-chrome"].find((path) => path && existsSync(path));
  if (!executable) throw new Error("Set CANARY_BROWSER_EXECUTABLE to a Chromium browser for the page acceptance check");
  const port = await freePort();
  const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--window-size=1400,900", url], { windowsHide: true, stdio: "ignore" });
  let socket;
  const pending = new Map(), errors = [];
  let key = 0, launchError;
  browser.on("error", (error) => { launchError = error; });
  try {
    const tab = await until(async () => {
      if (launchError) throw launchError;
      return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((item) => item.type === "page" && item.url === url);
    }, Boolean);
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
    socket.addEventListener("message", (event) => {
      const value = JSON.parse(event.data);
      if (value.method === "Runtime.exceptionThrown") errors.push(value.params.exceptionDetails.text);
      if (value.id && pending.has(value.id)) {
        const request = pending.get(value.id); pending.delete(value.id); clearTimeout(request.timer);
        if (value.error) request.fail(new Error(value.error.message)); else request.done(value.result);
      }
    });
    const send = (method, params = {}) => new Promise((done, fail) => {
      const id = ++key, timer = setTimeout(() => { pending.delete(id); fail(new Error(`Browser command timed out: ${method}`)); }, 10000);
      pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result?.value;
    };
    await send("Runtime.enable");
    return await task({ evaluate, errors });
  } finally {
    for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error("Browser closed")); }
    socket?.close(); browser.kill();
  }
}
