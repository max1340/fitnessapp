const path = require('path');
const fs = require('fs');

const nodeModules = 'C:\\Users\\Maxim\\AppData\\Local\\Microsoft\\WinGet\\Packages\\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\\node-v24.20.0-win-x64\\node_modules\\@bubblewrap\\cli\\node_modules';
const { TwaManifest, TwaGenerator } = require(path.join(nodeModules, '@bubblewrap/core'));

(async () => {
  try {
    const targetDir = path.resolve(__dirname);
    console.log('Target directory:', targetDir);

    const manifestUrl = 'https://fitnessapp-8wn7.onrender.com/manifest.webmanifest';
    const m = await TwaManifest.fromWebManifest(manifestUrl);

    m.packageId = 'com.max1340.fitnessapp';
    m.name = 'Тренировки';
    m.launcherName = 'Тренировки';
    m.themeColor.rgb = 0x0b0b0c;
    m.backgroundColor.rgb = 0x0b0b0c;
    m.signingKey = {
      path: path.join(targetDir, 'android.keystore'),
      alias: 'android'
    };

    console.log('Validation:', m.validate());
    await m.saveToFile(path.join(targetDir, 'twa-manifest.json'));
    console.log('Saved twa-manifest.json');

    const generator = new TwaGenerator();
    console.log('Generating Android project files...');
    await generator.createTwaProject(targetDir, m);
    console.log('TWA project generated successfully!');
  } catch (err) {
    console.error('Error generating project:', err);
    process.exit(1);
  }
})();
