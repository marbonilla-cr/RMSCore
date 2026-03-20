(function () {
  'use strict';

  var WRAPPER_VERSION = '1.2.0';
  var RELOAD_COOLDOWN_MS = 5000;
  var TAP_THRESHOLD_MS = 600;
  var TAP_COUNT_REQUIRED = 3;
  var STORAGE_KEY = 'rmscore_tenants';
  var ACTIVE_TENANT_KEY = 'rmscore_active_tenant';

  var CENTRAL_LOGIN_ORIGIN =
    typeof window.__RMS_CENTRAL_ORIGIN__ === 'string' && window.__RMS_CENTRAL_ORIGIN__
      ? String(window.__RMS_CENTRAL_ORIGIN__).replace(/\/$/, '')
      : 'https://login.rmscore.app';

  var isCapacitor = typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform();
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

  var tenantScreen = document.getElementById('tenant-screen');
  var tenantList = document.getElementById('tenant-list');
  var centralEmailInput = document.getElementById('central-email-input');
  var centralPasswordInput = document.getElementById('central-password-input');
  var centralLoginBtn = document.getElementById('central-login-btn');
  var centralLoginError = document.getElementById('central-login-error');
  var clearTenantBtn = document.getElementById('clear-tenant-btn');

  var lastReloadTime = 0;
  var isOffline = false;
  var dotInterval = null;

  function getSavedTenants() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveTenant(slug) {
    var tenants = getSavedTenants();
    var exists = tenants.find(function (t) { return t.slug === slug; });
    if (!exists) {
      tenants.unshift({ slug: slug, addedAt: Date.now() });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tenants));
    }
  }

  function deleteTenant(slug) {
    var tenants = getSavedTenants().filter(function (t) {
      return t.slug !== slug;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tenants));
    if (localStorage.getItem(ACTIVE_TENANT_KEY) === slug) {
      localStorage.removeItem(ACTIVE_TENANT_KEY);
    }
  }

  function getActiveTenant() {
    return localStorage.getItem(ACTIVE_TENANT_KEY) || null;
  }

  function setActiveTenant(slug) {
    localStorage.setItem(ACTIVE_TENANT_KEY, slug);
  }

  function getTenantUrl(slug) {
    return 'https://' + slug + '.rmscore.app';
  }

  function renderTenantList() {
    var tenants = getSavedTenants();
    if (!tenantList) return;

    tenantList.innerHTML = '';

    if (tenants.length === 0) return;

    var divider = document.createElement('div');
    divider.className = 'tenant-divider';
    divider.textContent = 'Acceso rápido';

    tenants.forEach(function (t) {
      var item = document.createElement('div');
      item.className = 'tenant-item';
      item.innerHTML =
        '<div class="tenant-item-info">' +
          '<div class="tenant-item-name">' + t.slug + '</div>' +
          '<div class="tenant-item-url">' + t.slug + '.rmscore.app</div>' +
        '</div>' +
        '<div class="tenant-item-actions">' +
          '<button class="tenant-item-connect" data-slug="' + t.slug + '">Abrir</button>' +
          '<button class="tenant-item-delete" data-slug="' + t.slug + '">✕</button>' +
        '</div>';

      item.querySelector('.tenant-item-connect').addEventListener('click',
        function (e) {
          e.stopPropagation();
          connectToTenant(e.target.getAttribute('data-slug'));
        }
      );

      item.querySelector('.tenant-item-delete').addEventListener('click',
        function (e) {
          e.stopPropagation();
          deleteTenant(e.target.getAttribute('data-slug'));
          renderTenantList();
        }
      );

      tenantList.appendChild(item);
    });

    tenantList.appendChild(divider);
  }

  function validateSlug(slug) {
    return /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug);
  }

  function connectToTenant(slug) {
    slug = slug.trim().toLowerCase();
    if (!validateSlug(slug)) {
      if (centralLoginError) {
        centralLoginError.textContent = 'Subdominio inválido.';
        centralLoginError.classList.remove('hidden');
      }
      return;
    }
    if (centralLoginError) centralLoginError.classList.add('hidden');
    saveTenant(slug);
    setActiveTenant(slug);
    if (tenantScreen) tenantScreen.classList.add('hidden');
    if (loadingScreen) loadingScreen.classList.remove('hidden');
    currentUrl = getTenantUrl(slug);
    setTimeout(function () {
      window.location.href = getTenantUrl(slug);
    }, 300);
  }

  function showTenantSelector() {
    if (tenantScreen) tenantScreen.classList.remove('hidden');
    if (loadingScreen) loadingScreen.classList.add('hidden');
    renderTenantList();
  }

  function hideCentralError() {
    if (centralLoginError) centralLoginError.classList.add('hidden');
  }

  function submitCentralLogin() {
    if (!centralEmailInput || !centralPasswordInput) return;

    hideCentralError();
    var email = centralEmailInput.value.trim();
    var password = centralPasswordInput.value;

    if (!email || !password) {
      if (centralLoginError) {
        centralLoginError.textContent = 'Ingresá correo y contraseña.';
        centralLoginError.classList.remove('hidden');
      }
      return;
    }

    if (centralLoginBtn) {
      centralLoginBtn.disabled = true;
      centralLoginBtn.textContent = 'Entrando...';
    }

    var url = CENTRAL_LOGIN_ORIGIN + '/api/auth/central-login';
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: email, password: password })
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (r) {
        if (!r.ok) {
          if (centralLoginError) {
            centralLoginError.textContent = r.body && r.body.message
              ? r.body.message
              : 'Credenciales incorrectas';
            centralLoginError.classList.remove('hidden');
          }
          return;
        }
        var data = r.body;
        if (!data.slug || !data.tenantUrl) {
          if (centralLoginError) {
            centralLoginError.textContent = 'Respuesta inválida del servidor';
            centralLoginError.classList.remove('hidden');
          }
          return;
        }
        saveTenant(data.slug);
        setActiveTenant(data.slug);
        if (tenantScreen) tenantScreen.classList.add('hidden');
        if (loadingScreen) loadingScreen.classList.remove('hidden');
        currentUrl = data.tenantUrl;
        window.location.href = data.tenantUrl;
      })
      .catch(function () {
        if (centralLoginError) {
          centralLoginError.textContent = 'Sin conexión o error de red';
          centralLoginError.classList.remove('hidden');
        }
      })
      .finally(function () {
        if (centralLoginBtn) {
          centralLoginBtn.disabled = false;
          centralLoginBtn.textContent = 'Entrar';
        }
      });
  }

  function setupCentralLogin() {
    if (centralLoginBtn) {
      centralLoginBtn.addEventListener('click', submitCentralLogin);
    }
    if (centralPasswordInput) {
      centralPasswordInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitCentralLogin();
      });
    }
    if (centralEmailInput) {
      centralEmailInput.addEventListener('input', hideCentralError);
    }
    if (clearTenantBtn) {
      clearTenantBtn.addEventListener('click', function () {
        localStorage.removeItem(ACTIVE_TENANT_KEY);
        localStorage.removeItem(STORAGE_KEY);
        window.location.reload();
      });
    }
  }

  function initTenantFlow() {
    var activeTenant = getActiveTenant();

    if (activeTenant) {
      var url = getTenantUrl(activeTenant);
      currentUrl = url;
      if (loadingScreen) loadingScreen.classList.remove('hidden');
      if (tenantScreen) tenantScreen.classList.add('hidden');
      setTimeout(function () {
        window.location.href = url;
      }, 500);
    } else {
      showTenantSelector();
    }
  }

  function detectEnvironment() {
    if (isCapacitor) {
      try {
        var serverUrl = window.Capacitor.getServerUrl
          ? window.Capacitor.getServerUrl()
          : '';
        currentUrl = serverUrl || currentUrl || window.location.href;
        isDev = currentUrl.startsWith('http://') ||
          currentUrl.indexOf('localhost') !== -1 ||
          currentUrl.indexOf('192.168') !== -1;
      } catch (e) {
        currentUrl = window.location.href;
        isDev = true;
      }
    } else {
      currentUrl = window.location.href;
      isDev = true;
    }
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
    if (offlineOverlay) offlineOverlay.classList.remove('hidden');
    startRetryAnimation();
  }

  function hideOffline() {
    if (!isOffline) return;
    isOffline = false;
    if (offlineOverlay) offlineOverlay.classList.add('hidden');
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
    if (dotInterval) { clearInterval(dotInterval); dotInterval = null; }
  }

  function reloadWithCooldown() {
    var now = Date.now();
    var timeSince = now - lastReloadTime;
    if (timeSince < RELOAD_COOLDOWN_MS) {
      var wait = Math.ceil((RELOAD_COOLDOWN_MS - timeSince) / 1000);
      if (retryInfo) retryInfo.textContent = 'Recargando en ' + wait + 's...';
      setTimeout(doReload, RELOAD_COOLDOWN_MS - timeSince);
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
          if (status.connected) { hideOffline(); } else { showOffline(); }
        });
        Network.getStatus().then(function (status) {
          if (!status.connected) showOffline();
        });
      }
    } catch (e) {
      setupBrowserNetwork();
    }
  }

  function setupBrowserNetwork() {
    window.addEventListener('online', hideOffline);
    window.addEventListener('offline', showOffline);
    if (!navigator.onLine) showOffline();
  }

  function setupBackButton() {
    if (!isCapacitor) return;
    try {
      var App = window.Capacitor.Plugins.App;
      if (App) {
        App.addListener('backButton', function (data) {
          if (tenantScreen && !tenantScreen.classList.contains('hidden')) {
            return;
          }
          if (data.canGoBack) {
            window.history.back();
          } else {
            if (confirm('¿Salir de RMSCore?')) App.exitApp();
          }
        });
      }
    } catch (e) {}
  }

  function setupStatusBar() {
    if (!isCapacitor) return;
    try {
      var StatusBar = window.Capacitor.Plugins.StatusBar;
      if (StatusBar) {
        StatusBar.setOverlaysWebView({ overlay: false });
        StatusBar.setStyle({ style: 'DARK' });
        StatusBar.setBackgroundColor({ color: '#f5f0eb' });
      }
    } catch (e) {}
  }

  function setupSplashScreen() {
    if (!isCapacitor) return;
    try {
      var SplashScreen = window.Capacitor.Plugins.SplashScreen;
      if (SplashScreen) {
        setTimeout(function () { SplashScreen.hide(); }, 2000);
      }
    } catch (e) {}
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
        if (now - lastTapTime > TAP_THRESHOLD_MS) tapCount = 0;
        tapCount++;
        lastTapTime = now;
        if (tapCount >= TAP_COUNT_REQUIRED) { tapCount = 0; toggleDebugPanel(); }
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
    var vEl = document.getElementById('debug-version');
    var eEl = document.getElementById('debug-env');
    var uEl = document.getElementById('debug-url');
    var tEl = document.getElementById('debug-tenant');
    var sEl = document.getElementById('debug-status');
    var cEl = document.getElementById('debug-cookies');

    if (vEl) vEl.textContent = 'v' + WRAPPER_VERSION;
    if (eEl) {
      eEl.textContent = isDev ? 'DESARROLLO' : 'PRODUCCIÓN';
      eEl.className = 'debug-value ' + (isDev ? 'env-badge-dev' : 'env-badge-prod');
    }
    if (uEl) uEl.textContent = currentUrl || window.location.href;
    if (tEl) tEl.textContent = getActiveTenant() || 'ninguno';
    if (sEl) {
      sEl.textContent = navigator.onLine ? 'Online' : 'Offline';
      sEl.style.color = navigator.onLine ? '#4ecca3' : '#e94560';
    }
    if (cEl) {
      var hasCookies = document.cookie.length > 0;
      cEl.textContent = hasCookies
        ? 'Activas (' + document.cookie.split(';').length + ')'
        : 'Sin cookies';
      cEl.style.color = hasCookies ? '#4ecca3' : '#ffd93d';
    }
  }

  function preventUnwantedZoom() {
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    var lastTouchEnd = 0;
    document.addEventListener('touchend', function (e) {
      var now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, false);
  }

  window.RMSCore = {
    changeTenant: function () {
      localStorage.removeItem(ACTIVE_TENANT_KEY);
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    },
    getActiveTenant: getActiveTenant,
    getCentralLoginOrigin: function () { return CENTRAL_LOGIN_ORIGIN; },
    version: WRAPPER_VERSION
  };

  function init() {
    detectEnvironment();
    setupNetworkDetection();
    setupBackButton();
    setupStatusBar();
    setupSplashScreen();
    setupDebugPanel();
    setupCentralLogin();
    preventUnwantedZoom();
    initTenantFlow();

    console.log('[RMSCore Wrapper] v' + WRAPPER_VERSION + ' initialized');
    console.log('[RMSCore Wrapper] central login:', CENTRAL_LOGIN_ORIGIN);
    console.log('[RMSCore Wrapper] Active tenant: ' + (getActiveTenant() || 'none'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
