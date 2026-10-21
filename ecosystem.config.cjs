const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "linkwatch-master",
      script: "dist/main.js",
      cwd: path.join(__dirname, "apps/master"),
      env: { NODE_ENV: "production" },
    },
  ],
};
