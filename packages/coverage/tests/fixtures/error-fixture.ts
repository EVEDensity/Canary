export function recover(fail: boolean): string {
  try {
    if (fail) throw new Error("boom");
    return "ok";
  } catch {
    return "caught";
  }
}
