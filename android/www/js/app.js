(function () {
  'use strict';

  var WRAPPER_VERSION = '1.1.0';
  var RELOAD_COOLDOWN_MS = 5000;
  var TAP_THRESHOLD_MS = 600;
  var TAP_COUNT_REQUIRED = 3;
  var STORAGE_KEY = 'rmscore_tenants';
  var ACTIVE_TENANT_KEY = 'rmscore_active_tenant';

  var isCapacitor = typeof window.Capacitor !== 'undefined' &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform();
  var isDev = false;
  var currentUrl = '';

  // DOM refs — existentes
  var offlineOverlay = document.getElementById('offline-overlay');
  var errorOverlay = document.getElementById('error-overlay');
  var errorMessage = document.getElementById('error-message');
  var debugPanel = document.getElementById('debug-panel');
  var debugTapArea = document.getElementById('debug-tap-area');
  var loadingScreen = document.getElementById('loading-screen');
  var retryInfo = document.getElementById('retry-info');
  var retryDots = document.getElementById('retry-dots');

  // DOM refs — tenant selector
  var tenantScreen = document.getElementById('tenant-screen');
  var tenantList = document.getElementById('tenant-list');
  var tenantSlugInput = document.getElementById('tenant-slug-input');
  var tenantConnectBtn = document.getElementById('tenant-connect-btn');
  var tenantInputError = document.getElementById('tenant-input-error');

  var lastReloadTime = 0;
  var isOffline = false;
  var dotInterval = null;

  // ============================================
  // TENANT STORAGE
  // ============================================

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
    // Si era el activo, limpiar
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

  // ============================================
  // TENANT SELECTOR UI
  // ============================================

  function renderTenantList() {
    var tenants = getSavedTenants();
    if (!tenantList) return;

    tenantList.innerHTML = '';

    if (tenants.length === 0) return;

    // Mostrar divisor "o agregar nuevo" solo si hay tenants
    var divider = document.createElement('div');
    divider.className = 'tenant-divider';
    divider.textContent = 'o agregar nuevo';

    tenants.forEach(function (t) {
      var item = document.createElement('div');
      item.className = 'tenant-item';
      item.innerHTML =
        '<div class="tenant-item-info">' +
          '<div class="tenant-item-name">' + t.slug + '</div>' +
          '<div class="tenant-item-url">' + t.slug + '.rmscore.app</div>' +
        '</div>' +
        '<div class="tenant-item-actions">' +
          '<button class="tenant-item-connect" data-slug="' + t.slug + '">Entrar</button>' +
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
      if (tenantInputError) {
        tenantInputError.textContent = 'Subdominio inválido. Solo letras, números y guiones.';
        tenantInputError.classList.remove('hidden');
      }
      return;
    }

    if (tenantInputError) tenantInputError.classList.add('hidden');

    saveTenant(slug);
    setActiveTenant(slug);

    // Mostrar loading
    if (tenantScreen) tenantScreen.classList.add('hidden');
    if (loadingScreen) loadingScreen.classList.remove('hidden');

    // Navegar al tenant
    var url = getTenantUrl(slug);
    currentUrl = url;

    setTimeout(function () {
      window.location.href = url;
    }, 300);
  }

  function showTenantSelector() {
    if (tenantScreen) tenantScreen.classList.remove('hidden');
    if (loadingScreen) loadingScreen.classList.add('hidden');
    renderTenantList();
  }

  function setupTenantForm() {
    if (!tenantConnectBtn || !tenantSlugInput) return;

    tenantConnectBtn.addEventListener('click', function () {
      connectToTenant(tenantSlugInput.value);
    });

    tenantSlugInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        connectToTenant(tenantSlugInput.value);
      }
    });

    tenantSlugInput.addEventListener('input', function () {
      if (tenantInputError) tenantInputError.classList.add('hidden');
    });
  }

  // ============================================
  // INIT — decide si mostrar selector o ir directo
  // ============================================

  function initTenantFlow() {
    var activeTenant = getActiveTenant();

    if (activeTenant) {
      // Hay tenant guardado — ir directo
      var url = getTenantUrl(activeTenant);
      currentUrl = url;

      if (loadingScreen) loadingScreen.classList.remove('hidden');
      if (tenantScreen) tenantScreen.classList.add('hidden');

      setTimeout(function () {
        window.location.href = url;
      }, 500);
    } else {
      // No hay tenant — mostrar selector
      showTenantSelector();
    }
  }

  // ============================================
  // LÓGICA EXISTENTE (sin cambios)
  // ============================================

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
          // Si estamos en el selector de tenant, no hacer nada
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

  // ============================================
  // CAMBIAR TENANT — función global para usar
  // desde el botón de cambio en el login del tenant
  // ============================================
  window.RMSCore = {
    changeTenant: function () {
      localStorage.removeItem(ACTIVE_TENANT_KEY);
      window.location.reload();
    },
    getActiveTenant: getActiveTenant,
    version: WRAPPER_VERSION
  };

  // ============================================
  // MAIN INIT
  // ============================================
  function init() {
    detectEnvironment();
    setupNetworkDetection();
    setupBackButton();
    setupStatusBar();
    setupSplashScreen();
    setupDebugPanel();
    setupTenantForm();
    preventUnwantedZoom();
    initTenantFlow();

    console.log('[RMSCore Wrapper] v' + WRAPPER_VERSION + ' initialized');
    console.log('[RMSCore Wrapper] Active tenant: ' + (getActiveTenant() || 'none'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
