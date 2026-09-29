'use strict';

// Electron display workArea and BrowserWindow bounds are both in DIP. Keep
// negative monitor origins intact and never multiply them by scaleFactor.
function constrain(area, desired) {
  const width = Math.min(area.width, Math.max(1, Math.round(desired.width)));
  const height = Math.min(area.height, Math.max(1, Math.round(desired.height)));
  return {
    x: Math.max(area.x, Math.min(Math.round(desired.x), area.x + area.width - width)),
    y: Math.max(area.y, Math.min(Math.round(desired.y), area.y + area.height - height)),
    width, height,
  };
}

function mainWindowLayout(area, bounds) {
  const minWidth = Math.min(320, area.width);
  const minHeight = Math.min(320, area.height);
  const width = Math.max(minWidth, bounds?.width ?? Math.min(1180, area.width));
  const height = Math.max(minHeight, bounds?.height ?? Math.min(800, area.height));
  return {
    ...constrain(area, {
      width, height,
      x: bounds?.x ?? area.x + (area.width - width) / 2,
      y: bounds?.y ?? area.y + (area.height - height) / 2,
    }),
    minWidth, minHeight,
  };
}

function petWindowLayout(area, bounds) {
  const margin = Math.min(20, Math.floor(Math.min(area.width, area.height) / 8));
  const scale = Math.min(1, (area.width - margin * 2) / 300, (area.height - margin * 2) / 340);
  const width = Math.max(1, Math.floor(300 * scale));
  const height = Math.max(1, Math.floor(340 * scale));
  return constrain(area, {
    width, height,
    x: bounds?.x ?? area.x + area.width - width - margin,
    y: bounds?.y ?? area.y + area.height - height - margin,
  });
}

module.exports = { mainWindowLayout, petWindowLayout };
