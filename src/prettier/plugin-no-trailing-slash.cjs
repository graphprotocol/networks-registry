module.exports = {
  parsers: {
    json: {
      ...require("prettier/parser-babel").parsers.json,
      preprocess: (text) => {
        const processValue = (value) => {
          if (typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"))) {
            return value.replace(/\/+$/, "");
          }
          if (Array.isArray(value)) {
            return value.map(processValue);
          }
          if (typeof value === "object" && value !== null) {
            return Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, processValue(v)]),
            );
          }
          return value;
        };

        const json = JSON.parse(text);
        const processed = processValue(json);
        return JSON.stringify(processed);
      },
    },
  },
};
