#!/usr/bin/env node

// Not part of compile:native yet: the helper's adapters still have to be
// calibrated against a real meeting (`--dump`). Until it joins compile:native
// and the bundle checks in release.yml / build-and-notarize.yml, builds without
// the binary simply hide the setting.
const { buildMacosSwiftBinary } = require("./lib/build-macos-swift-binary");

buildMacosSwiftBinary({
  label: "meeting-speaker-listener",
  sourceName: "macos-meeting-speaker-listener.swift",
  binaryName: "macos-meeting-speaker-listener",
});
