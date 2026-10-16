const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = (config) =>
  withAndroidManifest(config, (result) => {
    // Android deliberately excludes localeConfig from library manifest merging.
    result.modResults.manifest.application[0].$['android:localeConfig'] = '@xml/ow_locales';
    return result;
  });
