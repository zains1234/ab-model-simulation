
const { defineConfig } = require('vite');
const { resolve } = require('path');
const { viteStaticCopy } = require('vite-plugin-static-copy');

const PROJECT_ROOT = __dirname;
const PAGES_ROOT = resolve(PROJECT_ROOT, 'src/pages');

module.exports = defineConfig({
  root: PAGES_ROOT,

  publicDir: resolve(PROJECT_ROOT, 'public'),

  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: resolve(PROJECT_ROOT, 'src/css/**/*'),
          dest: 'css'
        },
        {
          src: resolve(PROJECT_ROOT, 'src/js/**/*'),
          dest: 'js'
        },
        {
          src: resolve(PROJECT_ROOT, 'src/components/**/*'),
          dest: 'components'
        }
      ]
    })
  ],

  build: {
    outDir: resolve(PROJECT_ROOT, 'dist'),
    emptyOutDir: true,

    rollupOptions: {
      input: {
        index: resolve(PAGES_ROOT, 'index.html'),
        configuration: resolve(PAGES_ROOT, 'configuration.html'),
        simulation: resolve(PAGES_ROOT, 'simulation.html')
      }
    }
  }
});
