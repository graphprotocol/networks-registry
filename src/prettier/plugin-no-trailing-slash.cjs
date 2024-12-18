module.exports = {
  parsers: {
    json: {
      ...require("prettier/parser-babel").parsers.json,
      preprocess: (text) => {
        // List of URLs that should keep their trailing slash
        const exceptions = [
          "https://explorer.lumia.org/api/",
        ];

        const processValue = (value) => {
          if (typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"))) {
            if (exceptions.includes(value)) {
              return value;
            }
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
