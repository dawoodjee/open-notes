module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],

    plugins: [
      // WHY THIS IS HERE, since nothing in our own code uses static class
      // blocks: react-stately ships them in its published ESM
      // (dist/private/color/Color.mjs), and it reaches our graph through
      // Gluestack's Menu, which is built on react-aria/react-stately. Without
      // this plugin a COLD bundle fails outright:
      //
      //   SyntaxError: node_modules/react-stately/.../Color.mjs:
      //   Static class blocks are not enabled.
      //
      // It went unnoticed because a long-running Metro session keeps serving
      // an already-transformed graph and updates it incrementally -- so the
      // running app looks fine while `curl`ing a fresh bundle, a clean CI
      // build, or a new device all fail. Pre-existing on main; fixed here
      // because it blocked verifying anything on a fresh install.
      '@babel/plugin-transform-class-static-block',
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './',
            'tailwind.config': './tailwind.config.js',
          },
        },
      ],
      'react-native-worklets/plugin', // Always last
    ],
  };
};
