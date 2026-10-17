export default {
  echo: async ({ value }) => ({ answer: "echo:" + value }),
  lookup: async ({ value }) => ({ answer: "lookup:" + value }),
};
