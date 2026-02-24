(function () {
  'use strict';

  var WRAPPER_VERSION = '1.0.0';
  var RELOAD_COOLDOWN_MS = 5000;
  var TAP_THRESHOLD_MS = 600;
  var TAP_COUNT_REQUIRED = 3;

  var isCapacitor = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  var isDev = false;
  var currentUrl = '';

  var offlineOverlay = document.getElementById('offline-overlay');
  var errorOverlay = document.getElementById('error-overlay');
  var errorMessage = document.getElementById('error-message');
  var debugPanel = document.getElementById('debug-panel');
  var debugTapArea = document.getElementById('debug-tap-area');
  var loadingScreen = document.getElementById('loading-screen');
  var retryInfo = document.getElementById('retry-info');
  var retryDots = document.getElementById('retry-dots');

  var lastReloadTime = 0;
  var isOffline = false;
  var retryInterval = null;
  var dotInterval = null;

  function detectEnvironment() {
    if (isCapacitor) {
      try {
        var serverUrl = window.Capacitor.getServerUrl ? window.Capacitor.getServerUrl() : '';
        currentUrl = serverUrl || window.location.href;
        isDev = currentUrl.startsWith('http://') || currentUrl.indexOf('localhost') !== -1 || currentUrl.indexOf('192.168') !== -1;
      } catch (e) {
        currentUrl = window.location.href;
        isDev = true;
      }
    } else {
      currentUrl = window.location.href;
      isDev = true;
    }
  }

  function validateProdUrl() {
    if (!isDev && currentUrl && !currentUrl.startsWith('https://')) {
      showError('La URL de producción debe usar HTTPS.\nURL actual: ' + currentUrl + '\n\nCorrige BASE_URL_PROD en tu archivo .env y recompila la app.');
      return false;
    }
    return true;
  }

  function showError(msg) {
    if (errorMessage && errorOverlay) {
      errorMessage.textContent = msg;
      errorOverlay.classList.remove('hidden');
    }
  }

  function showOffline() {
    if (isOffline) return;
    isOffline = true;
    if (offlineOverlay) {
      offlineOverlay.classList.remove('hidden');
    }
    startRetryAnimation();
  }

  function hideOffline() {
    if (!isOffline) return;
    isOffline = false;
    if (offlineOverlay) {
      offlineOverlay.classList.add('hidden');
    }
    stopRetryAnimation();
    reloadWithCooldown();
  }

  function startRetryAnimation() {
    var dots = '';
    if (dotInterval) clearInterval(dotInterval);
    dotInterval = setInterval(function () {
      dots = dots.length >= 3 ? '' : dots + '.';
      if (retryDots) retryDots.textContent = dots || '...';
    }, 500);
  }

  function stopRetryAnimation() {
    if (dotInterval) {
      clearInterval(dotInterval);
      dotInterval = null;
    }
  }

  function reloadWithCooldown() {
    var now = Date.now();
    var timeSinceLastReload = now - lastReloadTime;

    if (timeSinceLastReload < RELOAD_COOLDOWN_MS) {
      var waitTime = Math.ceil((RELOAD_COOLDOWN_MS - timeSinceLastReload) / 1000);
      if (retryInfo) {
        retryInfo.textContent = 'Recargando en ' + waitTime + 's...';
      }
      setTimeout(function () {
        doReload();
      }, RELOAD_COOLDOWN_MS - timeSinceLastReload);
      return;
    }

    doReload();
  }

  function doReload() {
    lastReloadTime = Date.now();
    if (retryInfo) retryInfo.textContent = '';
    window.location.reload();
  }

  function setupNetworkDetection() {
    if (isCapacitor) {
      setupCapacitorNetwork();
    } else {
      setupBrowserNetwork();
    }
  }

  function setupCapacitorNetwork() {
    try {
      var Network = window.Capacitor.Plugins.Network;
      if (Network) {
        Network.addListener('networkStatusChange', function (status) {
          if (status.connected) {
            hideOffline();
          } else {
            showOffline();
          }
        });

        Network.getStatus().then(function (status) {
          if (!status.connected) {
            showOffline();
          }
        });
      }
    } catch (e) {
      console.warn('Network plugin not available, falling back to browser events');
      setupBrowserNetwork();
    }
  }

  function setupBrowserNetwork() {
    window.addEventListener('online', function () {
      hideOffline();
    });

    window.addEventListener('offline', function () {
      showOffline();
    });

    if (!navigator.onLine) {
      showOffline();
    }
  }

  function setupBackButton() {
    if (!isCapacitor) return;

    try {
      var App = window.Capacitor.Plugins.App;
      if (App) {
        App.addListener('backButton', function (data) {
          if (data.canGoBack) {
            window.history.back();
          } else {
            if (confirm('¿Salir de RMS?')) {
              App.exitApp();
            }
          }
        });
      }
    } catch (e) {
      console.warn('App plugin not available for back button handling');
    }
  }

  function setupStatusBar() {
    if (!isCapacitor) return;

    try {
      var StatusBar = window.Capacitor.Plugins.StatusBar;
      if (StatusBar) {
        StatusBar.setStyle({ style: 'DARK' });
        StatusBar.setBackgroundColor({ color: '#1a1a2e' });
      }
    } catch (e) {
      console.warn('StatusBar plugin not available');
    }
  }

  function setupSplashScreen() {
    if (!isCapacitor) return;

    try {
      var SplashScreen = window.Capacitor.Plugins.SplashScreen;
      if (SplashScreen) {
        setTimeout(function () {
          SplashScreen.hide();
        }, 2000);
      }
    } catch (e) {
      console.warn('SplashScreen plugin not available');
    }
  }

  var tapCount = 0;
  var lastTapTime = 0;

  function setupDebugPanel() {
    if (!isDev) {
      if (debugTapArea) debugTapArea.classList.add('hidden');
      return;
    }

    if (debugTapArea) {
      debugTapArea.addEventListener('click', function () {
        var now = Date.now();
        if (now - lastTapTime > TAP_THRESHOLD_MS) {
          tapCount = 0;
        }
        tapCount++;
        lastTapTime = now;

        if (tapCount >= TAP_COUNT_REQUIRED) {
          tapCount = 0;
          toggleDebugPanel();
        }
      });
    }

    var debugClose = document.getElementById('debug-close');
    if (debugClose) {
      debugClose.addEventListener('click', function () {
        if (debugPanel) debugPanel.classList.add('hidden');
      });
    }
  }

  function toggleDebugPanel() {
    if (!debugPanel) return;

    if (debugPanel.classList.contains('hidden')) {
      updateDebugInfo();
      debugPanel.classList.remove('hidden');
    } else {
      debugPanel.classList.add('hidden');
    }
  }

  function updateDebugInfo() {
    var versionEl = document.getElementById('debug-version');
    var envEl = document.getElementById('debug-env');
    var urlEl = document.getElementById('debug-url');
    var statusEl = document.getElementById('debug-status');
    var cookiesEl = document.getElementById('debug-cookies');

    if (versionEl) versionEl.textContent = 'v' + WRAPPER_VERSION;

    if (envEl) {
      envEl.textContent = isDev ? 'DESARROLLO' : 'PRODUCCIÓN';
      envEl.className = 'debug-value ' + (isDev ? 'env-badge-dev' : 'env-badge-prod');
    }

    if (urlEl) urlEl.textContent = currentUrl || window.location.href;

    if (statusEl) {
      var online = navigator.onLine;
      statusEl.textContent = online ? '● Online' : '○ Offline';
      statusEl.style.color = online ? '#4ecca3' : '#e94560';
    }

    if (cookiesEl) {
      var hasCookies = document.cookie.length > 0;
      cookiesEl.textContent = hasCookies ? '● Activas (' + document.cookie.split(';').length + ')' : '○ Sin cookies';
      cookiesEl.style.color = hasCookies ? '#4ecca3' : '#ffd93d';
    }
  }

  function hideLoadingScreen() {
    if (loadingScreen) {
      setTimeout(function () {
        loadingScreen.style.opacity = '0';
        loadingScreen.style.transition = 'opacity 0.3s ease';
        setTimeout(function () {
          loadingScreen.classList.add('hidden');
          loadingScreen.style.opacity = '';
        }, 300);
      }, 1000);
    }
  }

  function preventUnwantedZoom() {
    document.addEventListener('gesturestart', function (e) {
      e.preventDefault();
    });

    var lastTouchEnd = 0;
    document.addEventListener('touchend', function (e) {
      var now = Date.now();
      if (now - lastTouchEnd <= 300) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    }, false);
  }

  function init() {
    detectEnvironment();

    if (!validateProdUrl()) return;

    setupNetworkDetection();
    setupBackButton();
    setupStatusBar();
    setupSplashScreen();
    setupDebugPanel();
    preventUnwantedZoom();
    hideLoadingScreen();

    console.log('[RMS Wrapper] v' + WRAPPER_VERSION + ' initialized');
    console.log('[RMS Wrapper] Environment: ' + (isDev ? 'DEV' : 'PROD'));
    console.log('[RMS Wrapper] URL: ' + currentUrl);
    console.log('[RMS Wrapper] Capacitor: ' + (isCapacitor ? 'Yes' : 'No'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
