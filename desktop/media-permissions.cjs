'use strict';

function localPage(url, origin) {
  try {
    const page = new URL(url);
    return page.origin === origin && !page.searchParams.has('pet') && !page.searchParams.has('overlay');
  } catch { return false; }
}

// Native media belongs to the visible main app. Floating pets and subframes never
// receive camera/microphone access, even when they share the local server origin.
function trustedMediaFrame({ webContents, mainWindow, origin, requestingUrl, isMainFrame }) {
  return !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    && !mainWindow.isMinimized() && webContents === mainWindow.webContents
    && isMainFrame === true && localPage(webContents.getURL(), origin) && localPage(requestingUrl, origin);
}

function canRequestMedia(context, permission, details = {}) {
  if (!trustedMediaFrame({ ...context, ...details })) return false;
  if (permission === 'speaker-selection') return true;
  return permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0
    && details.mediaTypes.every(type => type === 'audio' || type === 'video');
}

function canCheckMedia(context, permission, requestingOrigin, details = {}) {
  if (!trustedMediaFrame({ ...context, ...details }) || requestingOrigin !== context.origin) return false;
  if (permission === 'speaker-selection') return true;
  return permission === 'media' && (details.mediaType === 'audio' || details.mediaType === 'video');
}

module.exports = { canRequestMedia, canCheckMedia };
