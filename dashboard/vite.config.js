const { defineConfig } = require('vite');
const { resolve, relative, join } = require('path');
const fs = require('fs/promises');
const { minify } = require('terser');
const postcss = require('postcss');
const cssnano = require('cssnano');

const PROJECT_ROOT = __dirname;
const PAGES_ROOT = resolve(PROJECT_ROOT, 'src/pages');

async function getFiles(directory) {
  const entries = await fs.readdir(directory, {
    withFileTypes: true
  });

  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await getFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function copyAndMinify(sourceDir, destinationDir, type) {
  const files = await getFiles(sourceDir);

  for (const file of files) {
    const relativePath = relative(sourceDir, file);
    const destination = join(destinationDir, relativePath);

    await fs.mkdir(join(destination, '..'), {
      recursive: true
    });

    const content = await fs.readFile(file, 'utf8');

    if (type === 'js') {
      const result = await minify(content);

      if (result.error) {
        throw result.error;
      }

      await fs.writeFile(destination, result.code);
    }

    if (type === 'css') {
      const result = await postcss([
        cssnano()
      ]).process(content, {
        from: file,
        to: destination
      });

      await fs.writeFile(destination, result.css);
    }

    if (type === 'copy') {
      await fs.copyFile(file, destination);
    }
  }
}

function minifyStaticFiles() {
  return {
    name: 'minify-static-dashboard-files',

    async writeBundle() {
      const DIST_ROOT = resolve(PROJECT_ROOT, 'dist');

      await copyAndMinify(
        resolve(PROJECT_ROOT, 'src/js'),
        resolve(DIST_ROOT, 'js'),
        'js'
      );

      await copyAndMinify(
        resolve(PROJECT_ROOT, 'src/css'),
        resolve(DIST_ROOT, 'css'),
        'css'
      );

      await copyAndMinify(
        resolve(PROJECT_ROOT, 'src/components'),
        resolve(DIST_ROOT, 'components'),
        'copy'
      );

      console.log('Dashboard CSS and JS minified successfully.');
    }
  };
}

module.exports = defineConfig({
  root: PAGES_ROOT,

  publicDir: resolve(PROJECT_ROOT, 'public'),

  plugins: [
    minifyStaticFiles()
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