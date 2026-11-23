const { existsSync } = require("node:fs");
const { join } = require("node:path");

module.exports = ({ config }) => {
  // Local development can use a file beside app.json. Expo Build can inject it as an environment file.
  const localFile = join(__dirname, "google-services.json");
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (existsSync(localFile) ? localFile : undefined);
  if (!googleServicesFile) return config;

  return {
    ...config,
    android: { ...config.android, googleServicesFile },
  };
};
