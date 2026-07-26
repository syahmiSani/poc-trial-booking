/** @type {import('next').NextConfig} */
export default {
  // Produces .next/standalone, a self-contained server with only the modules
  // it actually traced. Keeps the published image small.
  output: "standalone",

  // `pg` is a native driver; keep it out of the client bundle.
  serverExternalPackages: ["pg"],

  webpack: (config) => {
    // src/ uses NodeNext-style ".js" import specifiers so the same files run
    // under tsx (tests, scripts) and under Next. Webpack does not map .js back
    // to .ts on its own, so tell it to.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
