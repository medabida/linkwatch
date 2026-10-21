// pm2 config for a remote worker machine. Pair it once with `pnpm worker --master ... --token ...`
// (credentials are saved to data/worker.json), then run `npm run worker:daemon`.
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "linkwatch-worker",
      script: "dist/main.js",
      cwd: path.join(__dirname, "apps/worker"),
      env: { NODE_ENV: "production" },
      kill_timeout: 10000,
    },
  ],
};
