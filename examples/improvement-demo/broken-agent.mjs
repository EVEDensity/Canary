export default async (input) => {
  if (input === "broken" || (input && typeof input === "object" && input.mode === "broken")) return null;
  return { value: input };
};
