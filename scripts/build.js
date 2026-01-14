const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'src');
const partialDir = path.join(projectRoot, 'partials');

const partials = {
  NAV: fs.readFileSync(path.join(partialDir, 'nav.html'), 'utf8'),
  FOOTER: fs.readFileSync(path.join(partialDir, 'footer.html'), 'utf8')
};

const pages = ['index.html', 'reading.html'];

pages.forEach((page) => {
  const srcPath = path.join(srcDir, page);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Missing source page: ${srcPath}`);
  }

  let content = fs.readFileSync(srcPath, 'utf8');
  Object.entries(partials).forEach(([key, value]) => {
    const token = `{{${key}}}`;
    if (!content.includes(token)) {
      throw new Error(`Token ${token} not found in ${page}`);
    }
    content = content.replace(token, value);
  });

  fs.writeFileSync(path.join(projectRoot, page), content);
});

console.log('Build complete: generated', pages.join(', '));
